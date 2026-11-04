"""Build a repaired full Sphero/EV3 File resource; preserve the supplied archive."""
from hashlib import sha256
from pathlib import Path
from zipfile import ZipFile
import json
import subprocess
import tempfile

root = Path(__file__).resolve().parent.parent
source = root / "sphero-boltplus-ev3-file-resource-20260927.zip"
expected_source_hash = "7509b9df4bfdb0f8ee0cf33916e1c2ad0aed049d1f2f2a7eef2d7e3ed161e091"
assert sha256(source.read_bytes()).hexdigest() == expected_source_hash, "Unexpected source archive"
version = "bolt-ev3-20261015-reconnect"
filename = "sphero-boltplus-ev3-file-resource-20261015-reconnect.zip"
package = root / filename
verification = root / "verification/original-resource"
verification.mkdir(parents=True, exist_ok=True)
stage = Path(tempfile.mkdtemp(prefix="candidate-", dir=verification))
restored = Path(tempfile.mkdtemp(prefix="restored-", dir=verification))
nested = Path(tempfile.mkdtemp(prefix="nested-", dir=verification)) / "pluginfile.php/123/mod_resource/content/1"

with ZipFile(source) as original:
    members = original.infolist()
    names = [item.filename for item in members]
    assert len(names) == len(set(names)), "Duplicate source members"
    for name in names:
        target = (stage / name).resolve()
        assert target.is_relative_to(stage.resolve()), f"Unsafe member: {name}"
    baseline = json.loads(original.read("release-manifest.json"))
    assert set(names) == set(baseline["files"]) | {"release-manifest.json"}
    for name, info in baseline["files"].items():
        data = original.read(name)
        assert len(data) == info["bytes"] and sha256(data).hexdigest() == info["sha256"], name
    original.extractall(stage)

bundle = stage / "static/js/main.55f08aa7.js"
patch_code = "const fs=require('node:fs');const patch=require(process.argv[1]);const path=process.argv[2];fs.writeFileSync(path,patch(fs.readFileSync(path,'utf8')));"
subprocess.run(["node", "-e", patch_code, str(root / "scripts/patch-original-transport.cjs"), str(bundle)], check=True)

old_worker_cleanup = """if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(regs) {
    regs.forEach(function(r) { r.unregister(); });
  });
}"""
scoped_worker_cleanup = """if ('serviceWorker' in navigator) {
  var resourceDirectory = new URL('./', window.location.href).href;
  var resourceRegistrations = navigator.serviceWorker.getRegistrations.bind(navigator.serviceWorker);
  // The bundled app also cleans up registrations. Restrict both callers to
  // this resource without altering the platform outside this document.
  navigator.serviceWorker.getRegistrations = function() {
    return resourceRegistrations().then(function(regs) {
      return regs.filter(function(r) {
        return new URL(r.scope).href.indexOf(resourceDirectory) === 0;
      });
    });
  };
  navigator.serviceWorker.getRegistrations().then(function(regs) {
    return Promise.all(regs.map(function(r) { return r.unregister(); }));
  }).catch(function() { /* Cleanup must not block the resource. */ });
}"""
index = stage / "index.html"
html = index.read_text()
assert html.count(old_worker_cleanup) == 1, "Unexpected service-worker cleanup"
assert "bolt-ev3-20260927" in html, "Expected old release queries"
html = html.replace(old_worker_cleanup, scoped_worker_cleanup).replace("bolt-ev3-20260927", version)
index.write_text(html)
config = stage / "resource-config.js"
assert config.read_text().count("bolt-ev3-20260927") == 1
config.write_text(config.read_text().replace("bolt-ev3-20260927", version))
readme = stage / "README-MOODLE-FILE-RESOURCE.md"
text = readme.read_text().replace(source.name, filename).replace("bolt-ev3-20260927", version)
text += """

## Reconnect repair — October 15, 2026

This replacement keeps the complete Sphero and EV3 resource. Only the
Web Bluetooth transport module changes inside the app bundle: old reads,
writes, notifications, and queued work are rejected after a drop; notification
setup waits for the browser; GATT handles are closed on teardown; delayed
chooser/connect results cannot reopen or disconnect a replacement session.
Reconnecting does not replay a running program.

The original app's battery monitoring and sleep-warning ping remain intact.
Its existing stop/disconnect/sleep behavior on a hidden or unloading page
is also retained. Keep the tab visible during connection and idle testing.

Release queries are updated so the modified bundle has a fresh browser cache
URL. Service-worker cleanup is restricted to this resource's directory;
unrelated Moodle/site workers and browser-saved programs are not cleared.

To update Moodle, export important programs first and retain the old ZIP as
rollback. Edit the existing File resource, replace its extracted files with
this ZIP's extracted contents, set index.html as the main file, choose Open,
and save. Keep the entire folder tree. The resource is a File resource,
not a course backup or SCORM package. Use Chrome over HTTPS.

Software fault simulations and restored-package browser checks are recorded
separately. This full-resource replacement still needs a physical Chromebook
test: connect and aim, run and stop, wait at least two minutes with the page
visible, disconnect/reconnect twice, and rerun. No permanent radio/firmware
stability guarantee is inferred from the software regression checks.
"""
readme.write_text(text)

allowed_changes = {"static/js/main.55f08aa7.js", "index.html", "resource-config.js", "README-MOODLE-FILE-RESOURCE.md", "release-manifest.json"}
manifest = dict(baseline)
manifest["version"] = version
manifest["hardwareValidation"] = "Pending physical Chromebook/BOLT+ and EV3 retest of this replacement"
manifest["sourceArchiveSha256"] = expected_source_hash
manifest["repair"] = {"module": 6490, "reconnectAndLifecycleGuards": True, "existingIdleAndHiddenPagePoliciesPreserved": True}
manifest["files"] = {name: {"bytes": (stage / name).stat().st_size, "sha256": sha256((stage / name).read_bytes()).hexdigest()} for name in baseline["files"]}
(stage / "release-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

changed = []
with ZipFile(source) as original, ZipFile(package, "w") as output:
    for info in members:
        name = info.filename
        data = (stage / name).read_bytes()
        if data != original.read(name):
            assert name in allowed_changes, f"Unrelated file changed: {name}"
            changed.append(name)
        output.writestr(info, data)
assert set(changed) == allowed_changes, "Unexpected repair scope"
with ZipFile(package) as archive:
    assert archive.testzip() is None
    assert set(archive.namelist()) == set(names)
    for name in names:
        assert archive.read(name) == (stage / name).read_bytes(), name
    for destination in [restored, nested]:
        archive.extractall(destination)
        for name in names:
            assert (destination / name).read_bytes() == archive.read(name), name
patch_package = root / "sphero-original-resource-reconnect-patch-20261015.zip"
with ZipFile(package) as archive, ZipFile(patch_package, "w") as patch:
    for name in sorted(changed):
        patch.writestr(archive.getinfo(name), archive.read(name))
with ZipFile(patch_package) as patch:
    assert patch.testzip() is None
    assert set(patch.namelist()) == set(changed)
    for name in changed:
        assert patch.read(name) == (stage / name).read_bytes(), name
assert sha256(source.read_bytes()).hexdigest() == expected_source_hash, "Original archive changed"
receipt = {"package": filename, "version": version, "bytes": package.stat().st_size,
    "sha256": sha256(package.read_bytes()).hexdigest(), "sourceArchiveUnchanged": True,
    "sourceArchiveSha256": expected_source_hash, "members": len(names), "changedFiles": sorted(changed),
    "unchangedFiles": len(names) - len(changed), "crcAndPostWriteByteChecks": True,
    "restoredByteChecks": True, "candidate": str(stage), "restored": str(restored), "nested": str(nested),
    "browserChecks": "pending", "actualMoodleUploaded": False, "physicalDeviceRetest": "pending"}
receipt["fiveFilePatch"] = {"package": patch_package.name, "bytes": patch_package.stat().st_size,
    "sha256": sha256(patch_package.read_bytes()).hexdigest(), "files": sorted(changed), "sourceVersionRequired": baseline["version"]}
(verification / "package-check.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps(receipt, indent=2))
