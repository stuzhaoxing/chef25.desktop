import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('receiver', Path(__file__).resolve().parents[1] / 'deploy/receive-release.py')
receiver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receiver)


class ReleaseValidationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.release = {'version': '0.1.0', 'preview': True, 'commit': 'a' * 40, 'platforms': {}}
        for platform, suffix in [*receiver.PLATFORMS.items(), ('source', '.tar.gz')]:
            name = f'Chef25_0.1.0_{platform}{suffix}'
            data = ('fixture for ' + platform).encode()
            (self.root / name).write_bytes(data)
            item = {'url': '/downloads/v0.1.0/' + name, 'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data)}
            if platform == 'source':
                self.release['source'] = item
            else:
                self.release['platforms'][platform] = item
        self.save_manifest()

    def tearDown(self):
        self.temporary.cleanup()

    def save_manifest(self):
        (self.root / 'distribution.json').write_text(json.dumps(self.release))
        (self.root / 'SHA256SUMS').write_text('\n'.join(f'{receiver.digest(file)}  {file.name}' for file in sorted(self.root.iterdir()) if file.name != 'SHA256SUMS') + '\n')

    def add_updates(self):
        self.release['updates'] = {}
        signature = base64.b64encode(('untrusted comment: fixture\n' + base64.b64encode(b'ED' + b'x' * 72).decode() + '\ntrusted comment: fixture\n' + base64.b64encode(b'x' * 64).decode() + '\n').encode()).decode()
        for platform, suffix in [('darwin-universal', '.app.tar.gz'), ('win32-x64', '.exe')]:
            name = f'Chef25_0.1.0_{platform}{suffix}'
            file = self.root / name
            if not file.exists():
                file.write_bytes(b'updater fixture')
            self.release['updates'][platform] = {'url': '/downloads/v0.1.0/' + name, 'size': file.stat().st_size, 'sha256': receiver.digest(file), 'signature': signature}
            self.release['platforms'][platform]['signing'] = 'notarized' if platform == 'darwin-universal' else 'unsigned'
        aliases = {'darwin-aarch64': 'darwin-universal', 'darwin-x86_64': 'darwin-universal', 'windows-x86_64': 'win32-x64'}
        updater = {'version': '0.1.0', 'platforms': {target: {'url': 'https://www.chef25.com' + self.release['updates'][platform]['url'], 'signature': signature} for target, platform in aliases.items()}}
        (self.root / 'updater.json').write_text(json.dumps(updater))
        self.save_manifest()

    def test_accepts_matching_updater_inventory(self):
        self.add_updates()
        self.assertEqual(len(receiver.validate(self.root)['updates']), 2)

    def test_rejects_mismatched_updater_manifest(self):
        self.add_updates()
        updater = json.loads((self.root / 'updater.json').read_text())
        updater['platforms']['darwin-aarch64']['url'] = 'https://example.org/update'
        (self.root / 'updater.json').write_text(json.dumps(updater))
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, 'artifact differs'):
            receiver.validate(self.root)

    def test_rejects_malformed_update_signature(self):
        self.add_updates()
        self.release['updates']['darwin-universal']['signature'] = 'invalid'
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, 'signature'):
            receiver.validate(self.root)

    def test_rejects_corrupted_update_archive(self):
        self.add_updates()
        (self.root / 'Chef25_0.1.0_darwin-universal.app.tar.gz').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'checksum|size'):
            receiver.validate(self.root)

    def test_accepts_complete_verified_preview(self):
        self.assertEqual(receiver.validate(self.root)['version'], '0.1.0')

    def test_rejects_changed_installer(self):
        (self.root / 'Chef25_0.1.0_win32-x64.exe').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'checksum|size'):
            receiver.validate(self.root)

    def test_rejects_missing_platform(self):
        del self.release['platforms']['darwin-universal']
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, 'Both'):
            receiver.validate(self.root)

    def test_rejects_external_or_traversing_download_paths(self):
        for url in ['https://example.org/file', '/downloads/v0.1.0/../../file']:
            with self.subTest(url=url):
                self.release['platforms']['darwin-universal']['url'] = url
                self.save_manifest()
                with self.assertRaisesRegex(ValueError, 'path'):
                    receiver.validate(self.root)

    def test_cannot_mislabel_unsigned_package_as_stable(self):
        self.release['preview'] = False
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, 'preview'):
            receiver.validate(self.root)

    def test_rejects_unexpected_file(self):
        (self.root / 'unreviewed.exe').write_bytes(b'extra')
        with self.assertRaisesRegex(ValueError, 'Unexpected'):
            receiver.validate(self.root)

    def test_checks_source_archive(self):
        (self.root / 'Chef25_0.1.0_source.tar.gz').write_bytes(b'wrong source')
        with self.assertRaisesRegex(ValueError, 'checksum|size'):
            receiver.validate(self.root)


if __name__ == '__main__':
    unittest.main()
