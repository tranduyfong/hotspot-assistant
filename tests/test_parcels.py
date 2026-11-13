import sys
import unittest
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from parcels import ParcelFinder, locate_parcels


class ParcelsTest(unittest.TestCase):
    def test_dotted_divider_separates_adjacent_codes(self):
        image = np.full((400, 400, 3), 255, np.uint8)
        cv2.rectangle(image, (100, 100), (220, 240), (120, 235, 255), -1)
        cv2.rectangle(image, (100, 100), (220, 240), (60, 60, 60), 1)
        for y in range(100, 241, 8):
            cv2.line(image, (160, y), (160, min(240, y + 4)), (90, 90, 90), 1)
        polygon = ParcelFinder(image).polygon([[123, 140], [137, 140], [137, 200], [123, 200]], [(190, 170)])
        self.assertIsNotNone(polygon)
        contour = np.asarray(polygon, dtype=np.int32)
        self.assertGreaterEqual(cv2.pointPolygonTest(contour, (130, 170), False), 0)
        self.assertLess(cv2.pointPolygonTest(contour, (190, 170), False), 0)
        self.assertLess(max(x for x, y in polygon), 165)

    def test_unseparated_row_is_not_reported_as_one_parcel(self):
        image = np.full((400, 400, 3), 255, np.uint8)
        cv2.rectangle(image, (100, 100), (220, 240), (120, 235, 255), -1)
        box = [[123, 140], [137, 140], [137, 200], [123, 200]]
        self.assertIsNone(ParcelFinder(image).polygon(box, [(190, 170)]))

    def test_pink_corner_parcel_is_supported(self):
        image = np.full((400, 400, 3), 255, np.uint8)
        cv2.rectangle(image, (100, 100), (180, 180), (170, 110, 235), -1)
        box = [[116, 130], [164, 130], [164, 146], [116, 146]]
        labels = locate_parcels(image, [dict(code='MT1-04', labelPolygon=box)])
        self.assertIsNotNone(labels[0]['polygon'])
        self.assertAlmostEqual(labels[0]['x'], 140, delta=2)
        self.assertAlmostEqual(labels[0]['y'], 140, delta=2)


if __name__ == '__main__':
    unittest.main()
