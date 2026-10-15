"""Package only the IDE, its dependencies, documentation and small source checks."""
from hashlib import sha256
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

root = Path(__file__).resolve().parent.parent
files = [
    "python-ide.html", "ide.js", "bolt-connection.js", "aim-controller.js", "python-worker.js",
    "python-ide.original.html", "README.md", "VALIDATION.md",
    "vendor/sphero/sphero-sdk.js", "vendor/sphero/toybox.js",
    "vendor/sphero/core-4.6.0.wasm", "vendor/sphero/PROVENANCE.txt",
    "scripts/extract-sphero-sdk.mjs", "scripts/package.py",
    "scripts/package-moodle.py", "scripts/check-moodle-package.mjs",
    "scripts/neo-reconnect-patch.cjs",
    "package.json", "package-lock.json",
    "tests/python-worker.test.mjs", "tests/sdk-cleanup.test.mjs", "tests/browser.test.mjs",
    "tests/neo-reconnect-regression.cjs", "tests/bolt-session.test.mjs",
    "examples/bolt_starter.py",
]
package = root / "pythonide-boltplus.zip"
with ZipFile(package, "w", ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(root / name, name)

verification = root / "verification"
verification.mkdir(exist_ok=True)
restored = verification / "restored"
with ZipFile(package) as archive:
    assert archive.testzip() is None, "ZIP CRC check failed"
    assert set(archive.namelist()) == set(files), "Unexpected ZIP inventory"
    for name in files:
        assert archive.read(name) == (root / name).read_bytes(), name
    archive.extractall(restored)
for name in files:
    assert (restored / name).read_bytes() == (root / name).read_bytes(), name
vendor_hashes = {
    "toybox.js": "e6e19079bd3f5b3fdf1e9d0512db73f2c454ad9d8e3c0a743a8f20b6c3e19019",
    "core-4.6.0.wasm": "88e05810dec9088949117a08eb2fcfa512d5b9d8774e8dbd0a39a368aefc4a4f",
}
for name, expected in vendor_hashes.items():
    assert sha256((root / "vendor/sphero" / name).read_bytes()).hexdigest() == expected, name
    reference = root / "reference/sdk" / name
    if reference.exists():
        assert reference.read_bytes() == (root / "vendor/sphero" / name).read_bytes()
original_archive = root / "sphero-boltplus-ev3-file-resource-20260927.zip"
record = {
    "package": package.name,
    "bytes": package.stat().st_size,
    "sha256": sha256(package.read_bytes()).hexdigest(),
    "files": len(files),
    "crcCheck": True,
    "postWriteByteChecks": True,
    "restoredByteChecks": True,
    "unmodifiedToyBoxAndWasm": True,
    "originalIdeSha256": sha256((root / "python-ide.original.html").read_bytes()).hexdigest(),
    "originalArchiveSha256": sha256(original_archive.read_bytes()).hexdigest() if original_archive.exists() else None,
    "restoredBrowserLoad": "pending",
}
(verification / "package-check.json").write_text(json.dumps(record, indent=2) + "\n")
print(json.dumps(record, indent=2))
