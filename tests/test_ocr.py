import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('ocr_worker', Path(__file__).resolve().parents[1] / 'scripts/ocr_worker.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PrintedCodeTests(unittest.TestCase):
    def test_preserves_leading_zero(self):
        self.assertEqual(module.codes_in('AS76-09'), ['AS76-09'])

    def test_area_does_not_merge_into_code(self):
        self.assertEqual(module.codes_in('AS76-09\n60.0m²'), ['AS76-09'])

    def test_spaces_around_separator_only(self):
        self.assertEqual(module.codes_in('AS76 - 09'), ['AS76-09'])
        self.assertEqual(module.codes_in('AS 76-09'), [])

    def test_conflicting_labels_remain_separate(self):
        self.assertEqual(module.codes_in('AS76-09 AS76-11'), ['AS76-09', 'AS76-11'])

    def test_no_guessed_digit(self):
        self.assertEqual(module.codes_in('AS76-O9'), [])
        self.assertEqual(module.codes_in('AS7O-09'), ['AS7O-09'])


if __name__ == '__main__':
    unittest.main()
