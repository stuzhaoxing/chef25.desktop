import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import test_release_receiver

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).resolve().parents[1] / 'deploy/publish-r2.py')
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class S3Error(Exception):
    def __init__(self, code):
        self.response = {'Error': {'Code': code}}


class MemoryS3:
    def __init__(self):
        self.objects = {}
        self.writes = []
        self.fail_key = None

    def list_multipart_uploads(self, **kwargs):
        return {}

    def list_objects_v2(self, **kwargs):
        return {'Contents': [{'Key': key, 'Size': len(data)} for key, data in self.objects.items()]}

    def put_object(self, **kwargs):
        key = kwargs['Key']
        if key == self.fail_key:
            raise S3Error('ServiceUnavailable')
        if kwargs.get('IfNoneMatch') == '*' and key in self.objects:
            raise S3Error('PreconditionFailed')
        body = kwargs['Body']
        self.objects[key] = body.read() if hasattr(body, 'read') else body
        self.writes.append(kwargs)

    def get_object(self, **kwargs):
        if kwargs['Key'] not in self.objects:
            raise S3Error('NoSuchKey')
        data = self.objects[kwargs['Key']]
        return {'Body': io.BytesIO(data), 'ContentLength': len(data)}

    def delete_object(self, **kwargs):
        del self.objects[kwargs['Key']]


class R2PublishTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_release_receiver.ReleaseValidationTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        self.fixture.add_updates()
        self.folder = self.fixture.root
        self.client = MemoryS3()
        self.origin = 'https://download.chef25.com'
        self.verified = []

    def verify(self, origin, key, file):
        self.assertEqual(origin, self.origin)
        self.assertEqual(self.client.objects[key], file.read_bytes())
        self.verified.append(key)

    def publish(self, activate=True, verifier=None):
        publisher.publish(self.client, 'test-bucket', self.folder, self.origin,
                          activate=activate, verifier=verifier or self.verify)

    def test_uploads_all_files_before_advancing_pointers(self):
        self.publish()
        keys = [item['Key'] for item in self.client.writes]
        self.assertEqual(keys[-2:], ['downloads/updater.json', 'downloads/latest.json'])
        self.assertEqual(len(self.verified), len(list(self.folder.iterdir())) + 2)
        self.assertNotIn(publisher.LOCK, self.client.objects)
        for item in self.client.writes[1:-2]:
            self.assertEqual(item['IfNoneMatch'], '*')
            self.assertIn('immutable', item['CacheControl'])
        self.assertTrue(all(item['CacheControl'] == 'no-store' for item in self.client.writes[-2:]))

    def test_capacity_failure_leaves_live_version_unchanged(self):
        self.client.objects['downloads/latest.json'] = b'{"version":"0.0.1"}'
        with patch.object(publisher, 'MAX_BUCKET_BYTES', 100), self.assertRaisesRegex(ValueError, 'budget'):
            self.publish()
        self.assertEqual(self.client.objects, {'downloads/latest.json': b'{"version":"0.0.1"}'})
        self.assertEqual(len(self.client.writes), 1)

    def test_capacity_counts_all_pages_and_planned_pointer_peak(self):
        pages = [{'Contents': [{'Key': 'unrelated', 'Size': 50}], 'IsTruncated': True, 'NextContinuationToken': 'next'},
                 {'Contents': [{'Key': 'downloads/latest.json', 'Size': 40}]}]
        with patch.object(self.client, 'list_objects_v2', side_effect=pages) as listing, patch.object(publisher, 'MAX_BUCKET_BYTES', 100):
            with self.assertRaisesRegex(ValueError, 'budget'):
                publisher.check_capacity(self.client, 'bucket', {'downloads/latest.json': 10, 'new': 11})
            self.assertEqual(listing.call_args.kwargs['ContinuationToken'], 'next')

    def test_capacity_does_not_double_count_identical_retry(self):
        self.client.objects['same'] = b'123'
        with patch.object(publisher, 'MAX_BUCKET_BYTES', 3):
            publisher.check_capacity(self.client, 'bucket', {'same': 3})

    def test_multipart_upload_blocks_release(self):
        with patch.object(self.client, 'list_multipart_uploads', return_value={'Uploads': [{}]}), self.assertRaisesRegex(ValueError, 'multipart'):
            self.publish()
        self.assertEqual(self.client.objects, {})

    def test_upload_only_does_not_change_live_version(self):
        self.publish(activate=False)
        self.assertNotIn('downloads/latest.json', self.client.objects)
        self.assertNotIn('downloads/updater.json', self.client.objects)

    def test_identical_release_retry_succeeds(self):
        self.publish()
        before = dict(self.client.objects)
        self.publish()
        self.assertEqual(before, self.client.objects)

    def test_same_version_changed_bytes_are_rejected(self):
        self.publish()
        previous = self.client.objects['downloads/latest.json']
        self.fixture.release['commit'] = 'b' * 40
        self.fixture.save_manifest()
        with self.assertRaisesRegex(ValueError, 'immutable'):
            self.publish()
        self.assertEqual(previous, self.client.objects['downloads/latest.json'])

    def test_existing_corrupt_object_is_not_overwritten(self):
        self.publish(activate=False)
        key = 'downloads/v0.1.0/Chef25_0.1.0_win32-x64.exe'
        self.client.objects[key] = b'corrupt object'
        with self.assertRaisesRegex(ValueError, 'immutable'):
            self.publish()
        self.assertEqual(self.client.objects[key], b'corrupt object')
        self.assertNotIn('downloads/latest.json', self.client.objects)

    def test_interrupted_upload_does_not_publish_and_can_resume(self):
        self.client.fail_key = 'downloads/v0.1.0/Chef25_0.1.0_win32-x64.exe'
        with self.assertRaises(S3Error):
            self.publish()
        self.assertNotIn('downloads/latest.json', self.client.objects)
        self.assertNotIn('downloads/updater.json', self.client.objects)
        self.assertNotIn(publisher.LOCK, self.client.objects)
        self.client.fail_key = None
        self.publish()

    def test_failed_public_verification_does_not_publish(self):
        def fail(*args):
            raise ValueError('Public download checksum mismatch')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            self.publish(verifier=fail)
        self.assertNotIn('downloads/latest.json', self.client.objects)
        self.assertNotIn('downloads/updater.json', self.client.objects)

    def test_interrupted_pointer_update_can_resume(self):
        self.client.fail_key = 'downloads/latest.json'
        with self.assertRaises(S3Error):
            self.publish()
        self.assertIn('downloads/updater.json', self.client.objects)
        self.assertNotIn('downloads/latest.json', self.client.objects)
        self.client.fail_key = None
        self.publish()

    def test_downgrade_checks_both_pointers(self):
        for key in ['downloads/latest.json', 'downloads/updater.json']:
            with self.subTest(key=key):
                self.client = MemoryS3()
                self.client.objects[key] = b'{"version":"0.2.0"}'
                with self.assertRaisesRegex(ValueError, 'downgrades'):
                    self.publish()
                self.assertEqual(len(self.client.writes), 1)  # Only the lock.

    def test_concurrent_publisher_cannot_replace_or_release_lock(self):
        self.client.objects[publisher.LOCK] = b'other publisher'
        with self.assertRaisesRegex(ValueError, 'lock'):
            self.publish()
        self.assertEqual(self.client.objects[publisher.LOCK], b'other publisher')
        self.assertEqual(self.client.writes, [])

    def test_corrupt_local_file_rejected_before_network(self):
        (self.folder / 'Chef25_0.1.0_win32-x64.exe').write_bytes(b'bad local file')
        with self.assertRaisesRegex(ValueError, 'checksum|size'):
            self.publish()
        self.assertEqual(self.client.writes, [])

    def test_new_custom_origin_and_legacy_origin_are_supported(self):
        path = self.folder / 'updater.json'
        path.write_text(path.read_text().replace('https://www.chef25.com', self.origin))
        self.fixture.save_manifest()
        self.publish()

    def test_untrusted_updater_origin_is_rejected(self):
        path = self.folder / 'updater.json'
        path.write_text(path.read_text().replace('https://www.chef25.com', 'https://untrusted.example'))
        self.fixture.save_manifest()
        with self.assertRaisesRegex(ValueError, 'artifact differs'):
            self.publish()

    def test_refuses_symlinked_artifact(self):
        source = self.folder / 'Chef25_0.1.0_source.tar.gz'
        source.unlink()
        source.symlink_to(self.folder / 'SHA256SUMS')
        with self.assertRaisesRegex(ValueError, 'regular'):
            self.publish()

    def test_origin_rejects_credentials_query_path_and_http(self):
        for origin in ['http://example.org', 'https://example.org/', 'https://example.org/path', 'https://example.org?key=x', 'https://user@example.org']:
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                publisher.origin(origin)


class Response(io.BytesIO):
    def __init__(self, data, url, status=200, headers=None):
        super().__init__(data)
        self.url = url
        self.status = status
        self.headers = headers or {'Content-Length': str(len(data))}

    def geturl(self):
        return self.url


class PublicDownloadTests(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.file = Path(self.temp.name) / 'app.exe'
        self.file.write_bytes(b'installer')
        self.url = 'https://download.chef25.com/downloads/v0.2.0/app.exe'

    def verify(self, responses):
        with patch.object(publisher, 'urlopen', side_effect=responses):
            publisher.verify_public('https://download.chef25.com', 'downloads/v0.2.0/app.exe', self.file)

    def test_valid_full_download_and_range(self):
        self.verify([Response(b'installer', self.url), Response(b'i', self.url, 206, {'Content-Range': 'bytes 0-0/9'})])

    def test_corrupt_same_length_response(self):
        with self.assertRaisesRegex(ValueError, 'checksum'):
            self.verify([Response(b'corrupted', self.url)])

    def test_ignored_range_request(self):
        with self.assertRaisesRegex(ValueError, 'Range'):
            self.verify([Response(b'installer', self.url), Response(b'installer', self.url)])

    def test_html_or_wrong_length_response(self):
        with self.assertRaisesRegex(ValueError, 'length'):
            self.verify([Response(b'<html>challenge</html>', self.url)])

    def test_redirect_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'directly'):
            self.verify([Response(b'installer', 'https://other.example/file')])

    def test_mutable_manifest_requires_no_store(self):
        url = 'https://download.chef25.com/downloads/latest.json'
        with patch.object(publisher, 'urlopen', return_value=Response(b'installer', url)):
            with self.assertRaisesRegex(ValueError, 'disable caching'):
                publisher.verify_public('https://download.chef25.com', 'downloads/latest.json', self.file)


if __name__ == '__main__':
    unittest.main()
