"""Build a flat Moodle File resource without changing the development app."""
from hashlib import sha256
from html.parser import HTMLParser
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import argparse
import json
import re
import base64
from tempfile import TemporaryDirectory
from package_output import output_path, release_id

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', default='pythonide-boltplus-moodle.zip')
parser.add_argument('--verification-dir', default='verification')
args = parser.parse_args()
try:
    output_file = output_path(root, args.output, 'moodle')
except ValueError as error:
    parser.error(str(error))
verification = (root / args.verification_dir).resolve()
verification.mkdir(parents=True, exist_ok=True)
html = (root / "python-ide.html").read_text()
scripts = ["vendor/sphero/sphero-sdk.js", "bolt-connection.js", "display-library.js", "bolt-course-api.js", "aim-controller.js", "display-library-ui.js", "ide.js"]
source_hashes = {}
for name in scripts:
    source = (root / name).read_text()
    source_hashes[name] = sha256((root / name).read_bytes()).hexdigest()
    if name == "vendor/sphero/sphero-sdk.js":
        source = "window.__SPHERO_RESOURCE_BASE_URL__ = new URL('./', document.baseURI).href;\n" + source
    elif name == 'display-library.js':
        # Inline local thumbnails to retain the five-file Moodle layout.
        manifest = json.loads((root / 'display-library-manifest.json').read_text())
        for path in sorted({item['path'] for item in manifest['thumbnails']}):
            data_url = 'data:image/png;base64,' + base64.b64encode((root / path).read_bytes()).decode()
            source = source.replace(json.dumps(path), json.dumps(data_url))
    elif name == "bolt-connection.js":
        for old, new in [
            ("new URL('vendor/sphero/toybox.js', document.baseURI)", "new URL('toybox.js', document.baseURI)"),
            ("The Sphero SDK is missing. Keep the vendor folder with this page.",
             "The bundled Sphero SDK could not load. Reopen the Moodle resource in Chrome."),
        ]:
            assert source.count(old) == 1, f"Expected one adapter replacement: {old}"
            source = source.replace(old, new)
    # A closing script tag inside a JS string must not end the HTML script.
    source = re.sub(r"</script", lambda match: "<\\/" + match.group()[2:], source, flags=re.I)
    tag = f'<script src="{name}"></script>'
    assert html.count(tag) == 1, f"Expected one source script: {name}"
    html = html.replace(tag, f'<script data-bundled-source="{name}">\n{source}\n</script>')


class RuntimeScripts(HTMLParser):
    def handle_starttag(self, tag, attrs):
        if tag == "script":
            src = dict(attrs).get("src")
            assert not src or src.startswith("https://"), f"Unexpected external local script: {src}"


RuntimeScripts().feed(html)
readme = """PYTHON IDE + BOLT+ — MOODLE PACKAGE

1. In your Moodle course, turn Edit mode on and add a File resource.
   Use a new resource for this test so the previous version stays available.
2. Upload pythonide-boltplus-moodle.zip into Select files.
3. Click the ZIP in Moodle and choose Unzip.
4. Click index.html and choose Set main file.
5. Set Appearance > Display to Open, then Save and display.

Keep all five extracted files together at the same level:
index.html, python-worker.js, toybox.js, core-4.6.0.wasm, README-MOODLE.txt.
The IDE and Sphero SDK scripts are bundled inside index.html.
This is a File resource ZIP, not a Moodle course backup.

On a Chromebook, open the HTTPS Moodle resource in Chrome. Internet is
required for the Python runtime and optional CodeMirror editor CDN.
Close other Sphero apps/tabs. Connect BOLT+, confirm the green dot, aim,
then run the starter on a clear floor. Wait two minutes after it finishes;
disconnect, reconnect, aim again, and rerun. Classroom testing remains
separate from the successful Mac test and local browser checks.

The working async starter, aiming, Neo reconnect repair, and idle
battery/sleep-warning maintenance are preserved from the current app.
Sphero SDK code is third-party code from the user-supplied archive;
no new license is granted here. The archive did not supply the LICENSE.txt
files referenced by its bundle headers. Original worker header retained.
"""
readme = readme.replace('pythonide-boltplus-moodle.zip', Path(args.output).name)
readme += """

EMOJI + ANIMATIONS LIBRARY (November 4 local build)
Use Emoji + animations to search the supplied Sphero app's 649 images
(including 58 emoji graphics) and 77 built-in animations, plus random choices.
Choose Use example, then connect/aim and Run. Names and DisplayImage /
DisplayAnimation constants work alongside numeric IDs. Thumbnails are embedded
in index.html; there are no extra preview files to upload. Custom GIF uploads,
URLs and arbitrary Unicode emoji text are not supported. The source catalogue
does not establish newer firmware asset coverage or physical display output.
"""
readme += """

CSE1240 commands are explicitly async: import them from sphero and await
set_heading, roll_to_distance, stop_roll, set_main_led, set_display_text,
get_ambient_light and delay. roll_to_distance uses centimetres and a whole
raw speed from 0 to 255; raw 25 is not 25 percent. It waits for the native
firmware distance-completion notification, not a timed approximation.
get_ambient_light stops first and waits for a fresh valid sensor packet.
Stop/error cleanup finishes before another run. An uncertain distance move
requires disconnect/reconnect before more motion; old completion packets
must never finish a later move. This software behavior still needs physical
Chromebook/BOLT+ distance, display, sensor and recovery acceptance.
"""
files = {
    "index.html": html.encode(),
    "python-worker.js": (root / "python-worker.js").read_bytes(),
    "toybox.js": (root / "vendor/sphero/toybox.js").read_bytes(),
    "core-4.6.0.wasm": (root / "vendor/sphero/core-4.6.0.wasm").read_bytes(),
    "README-MOODLE.txt": readme.encode(),
}
assert all(Path(name).name == name for name in files), "Moodle package must be flat"
build = TemporaryDirectory(prefix='.package-build-', dir=root)
package = Path(build.name) / output_file.name
with ZipFile(package, "w", ZIP_DEFLATED) as archive:
    for name, content in files.items():
        archive.writestr(name, content)

restored = verification / "moodle-restored"
nested = restored / "pluginfile.php/123/mod_resource/content/1"
with ZipFile(package) as archive:
    assert archive.testzip() is None, "ZIP CRC check failed"
    assert set(archive.namelist()) == set(files), "Unexpected ZIP files"
    for name, content in files.items():
        assert archive.read(name) == content, name
    for destination in [restored, nested]:
        archive.extractall(destination)
        for name, content in files.items():
            assert (destination / name).read_bytes() == content, name

record = {
    "package": package.name,
    "bytes": package.stat().st_size,
    "sha256": sha256(package.read_bytes()).hexdigest(),
    "files": list(files),
    "flatLayout": True,
    "sdkAndAppScriptsBundledInHtml": True,
    "crcCheck": True,
    "postWriteAndRestoredByteChecks": True,
    "unmodifiedPythonWorkerToyBoxAndWasm": True,
    "bundledSourceSha256": source_hashes,
    "browserChecks": "pending",
    "actualMoodleUploadTested": False,
    "release": release_id(root),
}
package.replace(output_file)
build.cleanup()
(verification / "moodle-package-check.json").write_text(json.dumps(record, indent=2) + "\n")
print(json.dumps(record, indent=2))
