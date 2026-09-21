import sys
import pathlib
import tempfile
import unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
from application_store import ApplicationStore, digest


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temporary.name) / 'apps'
        self.store = ApplicationStore(self.root)
        self.run_id = 'agent-loop-2026-09-21T01-00-00-000Z-abcdef12'

    def tearDown(self):
        self.temporary.cleanup()

    def test_source_conflict_and_existing_run(self):
        receipt = self.store.write(self.run_id, 'source', digest(''))
        with self.assertRaises(ValueError):
            self.store.write(self.run_id, 'new', digest('wrong'))
        with self.assertRaises(FileExistsError):
            ApplicationStore(self.root).write(self.run_id, 'takeover', digest(''))
        self.assertEqual(pathlib.Path(receipt['path']).read_text(), 'source')

    def test_path_and_link_rejection(self):
        with self.assertRaises(ValueError):
            self.store.write('../sdk', 'source', digest(''))
        self.root.symlink_to(pathlib.Path(self.temporary.name), target_is_directory=True)
        with self.assertRaises(ValueError):
            self.store.write(self.run_id, 'source', digest(''))

    def test_binary_hash_and_new_source_invalidate_build(self):
        self.store.write(self.run_id, 'source', digest(''))
        source, binary = self.store.check(self.run_id)
        binary.write_bytes(b'test RTP'); self.store.built(self.run_id)
        self.assertEqual(self.store.runnable(self.run_id), binary)
        binary.write_bytes(b'tampered')
        with self.assertRaises(ValueError):
            self.store.runnable(self.run_id)
        self.store.write(self.run_id, 'new', digest('source'))
        with self.assertRaises(ValueError):
            self.store.runnable(self.run_id)


if __name__ == '__main__':
    unittest.main()
