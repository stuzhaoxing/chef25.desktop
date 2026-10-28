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
