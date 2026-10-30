import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('setup_r2', Path(__file__).resolve().parents[1] / 'deploy/setup-r2.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.account = 'a' * 32
        self.zone = 'b' * 32
        self.env = {'CLOUDFLARE_ACCOUNT_ID': self.account, 'CLOUDFLARE_ZONE_ID': self.zone,
                    'CHEF25_R2_BUCKET': 'chef25-downloads', 'CHEF25_DOWNLOAD_ORIGIN': 'https://download.chef25.com'}
        self.zone_info = {'status': 'active', 'account': {'id': self.account}, 'name': 'chef25.com'}

    def test_default_only_plans_without_api_or_credentials(self):
        with patch.dict(os.environ, {}, clear=True), patch('sys.argv', ['setup-r2.py']), patch.object(setup, 'api') as api:
            setup.main()
            api.assert_not_called()

    def test_external_dns_does_not_require_cloudflare_zone(self):
        env = dict(self.env)
        env.pop('CLOUDFLARE_ZONE_ID')
        results = [{'storage_class': 'Standard'}, {'domains': []}, {}, {'enabled': False}]
        with patch.dict(os.environ, env, clear=True), patch('sys.argv', ['setup-r2.py', '--apply']), patch.object(setup, 'api', side_effect=results) as api:
            setup.main()
            self.assertFalse(any('zones/' in call.args[1] for call in api.call_args_list))

    def test_create_private_standard_bucket(self):
        results = [None, {}, {'domains': []}, {}, {'enabled': False}]
        with patch.dict(os.environ, self.env), patch('sys.argv', ['setup-r2.py', '--apply']), patch.object(setup, 'api', side_effect=results) as api:
            setup.main()
            calls = api.call_args_list
            self.assertEqual(calls[1].args[2], {'name': 'chef25-downloads', 'storage_class': 'Standard'})
            self.assertEqual(calls[3].args[2], {'enabled': False})
            self.assertFalse(any(call.args[0] == 'POST' and '/domains/' in call.args[1] for call in calls))

    def test_public_custom_domain_is_rejected(self):
        results = [{'storage_class': 'Standard'}, {'domains': [{'domain': 'download.chef25.com', 'enabled': True}]}]
        with patch.dict(os.environ, self.env), patch('sys.argv', ['setup-r2.py', '--apply']), patch.object(setup, 'api', side_effect=results):
            with self.assertRaisesRegex(ValueError, 'public custom domain'):
                setup.main()

    def test_existing_nonstandard_bucket_rejected(self):
        with patch.dict(os.environ, self.env), patch('sys.argv', ['setup-r2.py', '--apply']), patch.object(setup, 'api', side_effect=[{'storage_class': 'InfrequentAccess'}]) as api:
            with self.assertRaisesRegex(ValueError, 'Standard'):
                setup.main()
            self.assertEqual(api.call_count, 1)

    def test_repeat_setup_updates_existing_domain_without_creating_resources(self):
        results = [{'storage_class': 'Standard'}, {'domains': []}, {}, {'enabled': False}]
        with patch.dict(os.environ, self.env), patch('sys.argv', ['setup-r2.py', '--apply']), patch.object(setup, 'api', side_effect=results) as api:
            setup.main()
            self.assertNotIn('POST', [call.args[0] for call in api.call_args_list])


if __name__ == '__main__':
    unittest.main()
