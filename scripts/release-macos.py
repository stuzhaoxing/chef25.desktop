#!/usr/bin/env python3
"""Sign nested Node/app, notarize and staple, then build signed update and DMG artifacts."""
import base64
import hashlib
import json
import os
from pathlib import Path
import secrets
import shlex
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent
BUNDLE = ROOT / 'src-tauri/target/universal-apple-darwin/release/bundle'
APP = BUNDLE / 'macos/25小厨.app'
IDENTITY = os.environ['APPLE_SIGNING_IDENTITY']
TEAM = os.environ['APPLE_TEAM_ID']
AUTH = ['--apple-id', os.environ['APPLE_ID'], '--password', os.environ['APPLE_PASSWORD'], '--team-id', TEAM]


def run(arguments):
    result = subprocess.run(arguments, capture_output=True, text=True, cwd=ROOT)
    if result.returncode:
        # Signing and Apple output may contain account names/IDs. Keep it out of public CI logs.
        detail = result.stdout + result.stderr
        categories = {
            'unable to build chain': 'certificate chain is incomplete',
            'errSecInternalComponent': 'keychain access or certificate trust failed',
            'no identity found': 'signing identity was not found',
            'specified item could not be found': 'keychain item was not found',
            'timestamp service': 'Apple timestamp service failed',
        }
        reason = next((message for needle, message in categories.items() if needle in detail), 'inspect private signing/notary diagnostics')
        if Path(arguments[0]).name == 'hdiutil':
            for value in [IDENTITY, TEAM, os.environ['APPLE_ID'], os.environ['APPLE_PASSWORD']]:
                detail = detail.replace(value, '[redacted]')
            reason = detail.strip()[-1000:]
        raise RuntimeError(f'{Path(arguments[0]).name} failed: {reason}')
    return result.stdout + result.stderr


def notarize(payload, target):
    result = json.loads(run(['xcrun', 'notarytool', 'submit', str(payload), *AUTH, '--output-format', 'json']))
    submission = result['id']
    for attempt in range(3):
        waited = subprocess.run(['xcrun', 'notarytool', 'wait', submission, *AUTH, '--timeout', '15m', '--output-format', 'json'], capture_output=True, text=True)
        try:
            status = json.loads(waited.stdout).get('status')
        except json.JSONDecodeError:
            status = None
        if status == 'Accepted':
            break
        if status in {'Invalid', 'Rejected'}:
            raise RuntimeError('Apple rejected notarization; retrieve its private diagnostic log before retrying')
        if attempt == 2:
            raise RuntimeError('Apple notarization did not finish; signed files remain available for retry')
        time.sleep(15)
    run(['xcrun', 'stapler', 'staple', str(target)])
    run(['xcrun', 'stapler', 'validate', str(target)])
    print(f'Notarization accepted and ticket validated: {target.name}', flush=True)


def verify_app(app):
    run(['codesign', '--verify', '--deep', '--strict', str(app)])
    info = run(['codesign', '-dvv', str(app)])
    if f'TeamIdentifier={TEAM}' not in info or f'Authority={IDENTITY}' not in info or 'runtime' not in info:
        raise RuntimeError('App signing identity or hardened runtime mismatch')
    run(['lipo', str(app / 'Contents/MacOS/chef25-desktop'), '-verify_arch', 'arm64', 'x86_64'])
    run(['lipo', str(app / 'Contents/Resources/runtime/node'), '-verify_arch', 'arm64', 'x86_64'])


def main():
    preflight = sys.argv[1:] == ['--preflight']
    if not preflight and not APP.is_dir():
        raise RuntimeError('Build the Universal app bundle first')
    version = json.loads((ROOT / 'package.json').read_text())['version']
    if not preflight:
        (BUNDLE / 'macos/signing-status.json').unlink(missing_ok=True)
    with tempfile.TemporaryDirectory(prefix='chef25-signing-') as temporary:
        temp = Path(temporary)
        keychain = temp / 'build.keychain-db'
        keychain_args = []
        original_keychains = None
        try:
            if os.environ.get('APPLE_CERTIFICATE'):
                certificate = temp / 'certificate.p12'
                certificate.write_bytes(base64.b64decode(os.environ['APPLE_CERTIFICATE'], validate=True))
                certificate.chmod(0o600)
                password = secrets.token_urlsafe(32)
                run(['security', 'create-keychain', '-p', password, str(keychain)])
                run(['security', 'set-keychain-settings', '-lut', '21600', str(keychain)])
                run(['security', 'unlock-keychain', '-p', password, str(keychain)])
                run(['security', 'import', str(certificate), '-k', str(keychain), '-P', os.environ['APPLE_CERTIFICATE_PASSWORD'], '-T', '/usr/bin/codesign'])
                run(['security', 'set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', password, str(keychain)])
                original_keychains = shlex.split(run(['security', 'list-keychains', '-d', 'user']))
                run(['security', 'list-keychains', '-d', 'user', '-s', str(keychain), *original_keychains])
                keychain_args = ['--keychain', str(keychain)]
            if preflight:
                source = temp / 'signing-check.c'
                executable = temp / 'signing-check'
                source.write_text('int main(void) { return 0; }\n')
                run(['clang', '-arch', 'arm64', '-arch', 'x86_64', str(source), '-o', str(executable)])
                run(['codesign', '--force', '--timestamp', '--options', 'runtime', '--sign', IDENTITY, *keychain_args, str(executable)])
                run(['codesign', '--verify', '--strict', str(executable)])
                print('CI Developer ID certificate and keychain preflight passed', flush=True)
                return
            node = APP / 'Contents/Resources/runtime/node'
            run(['codesign', '--force', '--timestamp', '--options', 'runtime', '--entitlements', str(ROOT / 'src-tauri/node-entitlements.plist'), '--sign', IDENTITY, *keychain_args, str(node)])
            manifest_path = APP / 'Contents/Resources/runtime/manifest.json'
            manifest = json.loads(manifest_path.read_text())
            manifest['nodeSha256'] = hashlib.sha256(node.read_bytes()).hexdigest()
            manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
            run(['codesign', '--force', '--timestamp', '--options', 'runtime', '--sign', IDENTITY, *keychain_args, str(APP)])
            verify_app(APP)
            run(['ditto', '-c', '-k', '--keepParent', str(APP), str(temp / 'app.zip')])
            notarize(temp / 'app.zip', APP)
            run(['spctl', '--assess', '--type', 'execute', str(APP)])
            updater = BUNDLE / 'macos/25小厨.app.tar.gz'
            run(['tar', '--no-mac-metadata', '--no-xattrs', '-czf', str(updater), '-C', str(APP.parent), APP.name])
            run([str(ROOT / 'node_modules/.bin/tauri'), 'signer', 'sign', '--app-version', version, str(updater)])
            extracted = temp / 'updater-check'
            extracted.mkdir()
            run(['tar', '-xzf', str(updater), '-C', str(extracted)])
            verify_app(extracted / APP.name)
            run(['xcrun', 'stapler', 'validate', str(extracted / APP.name)])
            run(['spctl', '--assess', '--type', 'execute', str(extracted / APP.name)])
            image_root = temp / 'image'
            image_root.mkdir()
            run(['ditto', str(APP), str(image_root / APP.name)])
            (image_root / 'Applications').symlink_to('/Applications')
            dmg_directory = BUNDLE / 'dmg'
            dmg_directory.mkdir(exist_ok=True)
            version = json.loads((ROOT / 'package.json').read_text())['version']
            dmg = dmg_directory / f'Chef25_{version}_darwin-universal.dmg'
            # makehybrid avoids temporary filesystem mounts during image creation on CI.
            raw_dmg = temp / 'hybrid.dmg'
            run(['hdiutil', 'makehybrid', '-default-volume-name', '25小厨', '-hfs', '-o', str(raw_dmg), str(image_root)])
            run(['hdiutil', 'convert', str(raw_dmg), '-format', 'UDZO', '-ov', '-o', str(dmg)])
            run(['codesign', '--force', '--timestamp', '--sign', IDENTITY, *keychain_args, str(dmg)])
            notarize(dmg, dmg)
            run(['codesign', '--verify', '--strict', str(dmg)])
            run(['spctl', '--assess', '--type', 'open', '--context', 'context:primary-signature', str(dmg)])
            run(['hdiutil', 'verify', str(dmg)])
            (BUNDLE / 'macos/signing-status.json').write_text(json.dumps({'macos': 'notarized', 'updater': 'signed', 'version': version}) + '\n')
            print('Developer ID, app/DMG notarization, stapled updater, Gatekeeper and Universal checks passed', flush=True)
        finally:
            if original_keychains is not None:
                subprocess.run(['security', 'list-keychains', '-d', 'user', '-s', *original_keychains], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if keychain.exists():
                subprocess.run(['security', 'delete-keychain', str(keychain)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == '__main__':
    main()
