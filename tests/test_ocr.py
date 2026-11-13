import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('ocr_worker', Path(__file__).resolve().parents[1] / 'scripts/ocr_worker.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PrintedCodeTests(unittest.TestCase):
    def test_connected_street_cannot_move_a_label_to_its_centroid(self):
        import numpy as np
        street = np.array([[[0, 0]], [[80, 0]], [[80, 600]], [[0, 600]]], dtype=np.int32)
        box = np.array([[10, 30], [70, 30], [70, 40], [10, 40]], dtype=np.float32)
        self.assertFalse(module.compact_lot(street, box, (40, 35)))

    def test_nearby_compact_parcel_is_accepted(self):
        import numpy as np
        parcel = np.array([[[0, 0]], [[80, 0]], [[80, 30]], [[0, 30]]], dtype=np.int32)
        box = np.array([[10, 8], [70, 8], [70, 18], [10, 18]], dtype=np.float32)
        self.assertTrue(module.compact_lot(parcel, box, (40, 13)))

    def test_tiled_ocr_keeps_seam_labels_and_image_coordinates(self):
        import numpy as np
        regions = list(module.image_regions(np.zeros((1300, 1400, 3), dtype=np.uint8)))
        self.assertEqual(len(regions), 4)
        self.assertTrue(any(left == 1040 and top == 1040 for left, top, _ in regions))
        for x, y in [(0, 0), (1199, 1199), (1399, 1299)]:
            self.assertTrue(any(left <= x < left + image.shape[1] and top <= y < top + image.shape[0]
                                for left, top, image in regions))

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
