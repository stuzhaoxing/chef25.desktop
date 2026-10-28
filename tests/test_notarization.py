import importlib.util
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch


class NotarizationTicketTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('macos_release', Path(__file__).resolve().parents[1] / 'scripts/release-macos.py')
        self.release = importlib.util.module_from_spec(spec)
        with patch.dict(os.environ, {'APPLE_SIGNING_IDENTITY': 'fixture', 'APPLE_TEAM_ID': 'fixture', 'APPLE_ID': 'fixture', 'APPLE_PASSWORD': 'fixture'}):
            spec.loader.exec_module(self.release)

    def test_retries_ticket_propagation_without_resubmitting(self):
        calls = []
        attempts = 0

        def run(arguments):
            nonlocal attempts
            calls.append(arguments)
            if 'submit' in arguments:
                return '{"id":"fixture"}'
            if 'staple' in arguments:
                attempts += 1
                if attempts < 3:
                    raise RuntimeError('ticket not propagated')
            return ''

        accepted = subprocess.CompletedProcess([], 0, '{"status":"Accepted"}', '')
        with patch.object(self.release, 'run', side_effect=run), patch.object(self.release.subprocess, 'run', return_value=accepted), patch.object(self.release.time, 'sleep') as sleep:
            self.release.notarize(Path('app.zip'), Path('fixture.app'))
        self.assertEqual(attempts, 3)
        self.assertEqual(sum('submit' in args for args in calls), 1)
        self.assertEqual(sleep.call_count, 2)
        self.assertIn('validate', calls[-1])

    def test_exhausted_ticket_retries_still_block_release(self):
        def run(arguments):
            if 'submit' in arguments:
                return '{"id":"fixture"}'
            raise RuntimeError('ticket unavailable')

        accepted = subprocess.CompletedProcess([], 0, '{"status":"Accepted"}', '')
        with patch.object(self.release, 'run', side_effect=run), patch.object(self.release.subprocess, 'run', return_value=accepted), patch.object(self.release.time, 'sleep') as sleep:
            with self.assertRaisesRegex(RuntimeError, 'after six attempts'):
                self.release.notarize(Path('app.zip'), Path('fixture.app'))
        self.assertEqual(sleep.call_count, 5)


if __name__ == '__main__':
    unittest.main()
