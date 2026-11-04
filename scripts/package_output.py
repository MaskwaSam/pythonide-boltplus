"""Restrict builds to mutable default outputs or this release's own artifact."""
from pathlib import Path
import re


def release_id(root):
    html = (Path(root) / 'python-ide.html').read_text()
    match = re.search(r'<meta name="pythonide-release" content="(boltplus-[a-z0-9-]+-\d{8})">', html)
    if not match:
        raise ValueError('Missing or invalid current BOLT+ release identity')
    return match.group(1)


def output_path(root, filename, kind):
    root = Path(root).resolve()
    release = release_id(root)
    name, date = release.rsplit('-', 1)
    allowed = {
        'development': {'pythonide-boltplus.zip', f'pythonide-{release}.zip'},
        'moodle': {'pythonide-boltplus-moodle.zip', f'pythonide-{name}-moodle-{date}.zip'},
    }[kind]
    if filename not in allowed or Path(filename).name != filename:
        raise ValueError('Output must be one of: ' + ', '.join(sorted(allowed)) + '. Source archives and historical releases are protected.')
    target = root / filename
    if target.is_symlink():
        raise ValueError('Package output must not be a symbolic link')
    if target.exists() and target.stat().st_nlink > 1:
        raise ValueError('Package output must not share a hard link with another file')
    return target
