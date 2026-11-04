import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scripts = fileURLToPath(new URL('../scripts/', import.meta.url));
test('package destinations protect source archives, historical releases, paths and aliases', () => {
  const check = String.raw`
import pathlib, sys, tempfile
sys.path.insert(0, sys.argv[1])
from package_output import output_path, release_id
with tempfile.TemporaryDirectory() as directory:
    root = pathlib.Path(directory).resolve()
    (root / 'python-ide.html').write_text('<meta name="pythonide-release" content="boltplus-display-library-20261104">')
    source = root / 'sphero-boltplus-ev3-file-resource-20260927.zip'
    source.write_bytes(b'preserved source archive')
    historical = root / 'pythonide-boltplus-moodle-cse1240-20261015.zip'
    historical.write_bytes(b'preserved older release')
    for kind, valid in [('development', 'pythonide-boltplus-display-library-20261104.zip'), ('moodle', 'pythonide-boltplus-display-library-moodle-20261104.zip')]:
        assert output_path(root, valid, kind) == root / valid
        for name in [source.name, historical.name, '../outside.zip', str(root / valid), 'python-worker.js']:
            try: output_path(root, name, kind)
            except ValueError: pass
            else: raise AssertionError(name)
        destination = root / valid
        destination.symlink_to(source)
        try:
            try: output_path(root, valid, kind)
            except ValueError: pass
            else: raise AssertionError('symlink accepted')
        finally: destination.unlink()
        destination.hardlink_to(source)
        try:
            try: output_path(root, valid, kind)
            except ValueError: pass
            else: raise AssertionError('hard link accepted')
        finally: destination.unlink()
    assert source.read_bytes() == b'preserved source archive'
    assert historical.read_bytes() == b'preserved older release'
`;
  const result = spawnSync('python3', ['-c', check, scripts], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});

test('both builders reject protected filenames and a failed build preserves its prior output', () => {
  const check = String.raw`
import pathlib, shutil, subprocess, sys, tempfile
scripts = pathlib.Path(sys.argv[1])
with tempfile.TemporaryDirectory() as directory:
    root = pathlib.Path(directory)
    (root / 'scripts').mkdir()
    for name in ['package.py', 'package-moodle.py', 'package_output.py']:
        shutil.copyfile(scripts / name, root / 'scripts' / name)
    (root / 'python-ide.html').write_text('<meta name="pythonide-release" content="boltplus-display-library-20261104">')
    source = root / 'sphero-boltplus-ev3-file-resource-20260927.zip'
    source.write_bytes(b'preserved source archive')
    for name in ['package.py', 'package-moodle.py']:
        result = subprocess.run([sys.executable, root / 'scripts' / name, '--output', source.name], capture_output=True)
        assert result.returncode == 2, result.stderr
        assert b'protected' in result.stderr
        assert source.read_bytes() == b'preserved source archive'
    output = root / 'pythonide-boltplus-display-library-20261104.zip'
    output.write_bytes(b'prior working release')
    (root / 'display-library-manifest.json').write_text('{"thumbnails":[]}')
    result = subprocess.run([sys.executable, root / 'scripts' / 'package.py', '--output', output.name], capture_output=True)
    assert result.returncode != 0  # Missing runtime files fault the temporary ZIP.
    assert output.read_bytes() == b'prior working release'
    assert source.read_bytes() == b'preserved source archive'
`;
  const result = spawnSync('python3', ['-c', check, scripts], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
