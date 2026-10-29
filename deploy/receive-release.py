#!/usr/bin/env python3
"""Forced SSH command for Chef25 downloads; no shell, sudo, or service management."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tarfile
import tempfile

ROOT = Path('/srv/chef25/downloads')
PLATFORMS = {'darwin-universal': '.dmg', 'win32-x64': '.exe'}


def digest(file):
    result = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def validate(folder, updater_origin='https://www.chef25.com'):
    release = json.loads((folder / 'distribution.json').read_text())
    version = release.get('version', '')
    if not re.fullmatch(r'\d+\.\d+\.\d+', version) or release.get('preview') is not True:
        raise ValueError('Only explicitly marked preview releases are accepted by this receiver')
    if not re.fullmatch(r'[a-f0-9]{40}', release.get('commit', '')):
        raise ValueError('Build commit is missing')
    if set(release['platforms']) != set(PLATFORMS):
        raise ValueError('Both platforms must succeed before publication')
    expected = {'distribution.json', 'SHA256SUMS'}
    for platform, extension in [*PLATFORMS.items(), ('source', '.tar.gz')]:
        item = release['source'] if platform == 'source' else release['platforms'][platform]
        filename = f'Chef25_{version}_{platform}{extension}'
        if item['url'] != f'/downloads/v{version}/{filename}':
            raise ValueError('Unexpected artifact path')
        file = folder / filename
        if item['size'] != file.stat().st_size or item['sha256'] != digest(file):
            raise ValueError('Artifact checksum or size mismatch')
        expected.add(filename)
    updates = release.get('updates')
    if updates is not None:
        if set(updates) != set(PLATFORMS):
            raise ValueError('Both updater platforms are required')
        for platform, extension in [('darwin-universal', '.app.tar.gz'), ('win32-x64', '.exe')]:
            item = updates[platform]
            filename = f'Chef25_{version}_{platform}{extension}'
            if item['url'] != f'/downloads/v{version}/{filename}':
                raise ValueError('Unexpected updater path')
            file = folder / filename
            if item['size'] != file.stat().st_size or item['sha256'] != digest(file):
                raise ValueError('Updater checksum or size mismatch')
            signature = item.get('signature', '')
            try:
                lines = base64.b64decode(signature, validate=True).decode('utf8').splitlines()
                if len(lines) != 4 or not lines[2].startswith('trusted comment: ') or len(base64.b64decode(lines[1], validate=True)) != 74 or len(base64.b64decode(lines[3], validate=True)) != 64:
                    raise ValueError('Invalid updater signature')
            except (ValueError, UnicodeError) as error:
                raise ValueError('Invalid updater signature') from error
            expected.add(filename)
        if release['platforms']['darwin-universal'].get('signing') != 'notarized' or release['platforms']['win32-x64'].get('signing') != 'unsigned':
            raise ValueError('Unexpected platform signing status')
        updater = json.loads((folder / 'updater.json').read_text())
        aliases = {'darwin-aarch64': 'darwin-universal', 'darwin-x86_64': 'darwin-universal', 'windows-x86_64': 'win32-x64'}
        if updater.get('version') != version or set(updater.get('platforms', {})) != set(aliases):
            raise ValueError('Updater manifest version or platforms differ')
        for target, platform in aliases.items():
            if updater['platforms'][target] != {'url': updater_origin + updates[platform]['url'], 'signature': updates[platform]['signature']}:
                raise ValueError('Updater manifest artifact differs')
        expected.add('updater.json')
    elif version != '0.1.0':
        raise ValueError('New releases require signed updater artifacts')
    if {file.name for file in folder.iterdir()} != expected:
        raise ValueError('Unexpected or missing distribution files')
    sums = {}
    for line in (folder / 'SHA256SUMS').read_text().splitlines():
        checksum, name = line.split('  ', 1)
        if name in sums or name not in expected - {'SHA256SUMS'} or not re.fullmatch(r'[a-f0-9]{64}', checksum):
            raise ValueError('Invalid checksum inventory')
        sums[name] = checksum
    if set(sums) != expected - {'SHA256SUMS'}:
        raise ValueError('Incomplete checksum inventory')
    for name, checksum in sums.items():
        if digest(folder / name) != checksum:
            raise ValueError('Checksum inventory mismatch')
    return release


def main():
    import fcntl  # Linux SSH receiver only; shared validation also runs on Windows.

    if os.environ.get('SSH_ORIGINAL_COMMAND') != 'publish':
        raise ValueError('This key can only run publish')
    staging_root = ROOT / '.incoming'
    staging_root.mkdir(mode=0o700, exist_ok=True)
    with (staging_root / '.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        with tempfile.TemporaryDirectory(dir=staging_root) as temporary:
            folder = Path(temporary)
            total = 0
            seen = set()
            with tarfile.open(fileobj=sys.stdin.buffer, mode='r|gz') as archive:
                for member in archive:
                    if member.name in {'.', './'} and member.isdir():
                        continue
                    name = member.name.removeprefix('./')
                    total += member.size
                    if not member.isfile() or not re.fullmatch(r'[a-zA-Z0-9_.-]+', name) or name in seen or member.size < 0 or total > 3 * 1024**3 or len(seen) >= 10:
                        raise ValueError('Unsafe or oversized release archive')
                    seen.add(name)
                    source = archive.extractfile(member)
                    with (folder / name).open('wb') as target:
                        shutil.copyfileobj(source, target)
            release = validate(folder)
            destination = ROOT / ('v' + release['version'])
            latest = ROOT / 'latest.json'
            if latest.exists():
                current = json.loads(latest.read_text())
                if tuple(map(int, release['version'].split('.'))) < tuple(map(int, current['version'].split('.'))):
                    raise ValueError('Automatic downgrades are not allowed')
            if destination.exists():
                if (destination / 'distribution.json').read_bytes() != (folder / 'distribution.json').read_bytes():
                    raise ValueError('Version is immutable; use a new version number')
            else:
                for file in folder.iterdir():
                    os.chmod(file, 0o644)
                os.chmod(folder, 0o755)
                os.rename(folder, destination)
                # TemporaryDirectory cleanup tolerates a moved directory.
            pending = ROOT / '.latest.pending'
            if release.get('updates'):
                updater_pending = ROOT / '.updater.pending'
                updater_pending.write_bytes((destination / 'updater.json').read_bytes())
                os.chmod(updater_pending, 0o644)
                os.replace(updater_pending, ROOT / 'updater.json')
            pending.write_text(json.dumps(release, indent=2) + '\n')
            os.chmod(pending, 0o644)
            os.replace(pending, latest)
            print('Published complete Chef25 preview v' + release['version'])


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, tarfile.TarError) as error:
        print('Release rejected: ' + str(error), file=sys.stderr)
        sys.exit(1)
