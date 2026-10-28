#!/usr/bin/env python3
"""Run once as root after placing receive-release.py at the reviewed path."""
import os
from pathlib import Path
import pwd
import re
import subprocess
import sys

USER = 'chef25-release'
HOME_DIR = Path('/var/lib/chef25-release')
RECEIVER = Path('/usr/local/libexec/chef25-receive-release.py')

key = sys.stdin.read().strip()
if not re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/=]+(?: [a-zA-Z0-9@._-]+)?', key):
    raise ValueError('Expected exactly one Ed25519 public key')
if not RECEIVER.is_file() or RECEIVER.stat().st_uid != 0:
    raise ValueError('Install the root-owned receiver first')
try:
    user = pwd.getpwnam(USER)
    if user.pw_dir != str(HOME_DIR):
        raise ValueError('An unrelated account already has this name')
except KeyError:
    subprocess.run(['useradd', '--system', '--create-home', '--home-dir', str(HOME_DIR), '--shell', '/bin/sh', USER], check=True)
    user = pwd.getpwnam(USER)
os.chown(HOME_DIR, 0, 0)
os.chmod(HOME_DIR, 0o755)
ssh = HOME_DIR / '.ssh'
ssh.mkdir(exist_ok=True)
os.chown(ssh, 0, user.pw_gid)
os.chmod(ssh, 0o750)
authorized = ssh / 'authorized_keys'
line = f'restrict,command="python3 {RECEIVER}" {key}\n'
if authorized.exists() and authorized.read_text() != line:
    raise ValueError('Existing deployment key differs; rotate explicitly instead of overwriting')
authorized.write_text(line)
os.chown(authorized, 0, user.pw_gid)
os.chmod(authorized, 0o640)
downloads = Path('/srv/chef25/downloads')
downloads.mkdir(parents=True, exist_ok=True)
os.chown(downloads, user.pw_uid, user.pw_gid)
os.chmod(downloads, 0o755)
print('Restricted Chef25 download publisher installed; no sudo or interactive shell access granted.')
