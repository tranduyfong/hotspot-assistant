"""Find one printed parcel without treating a connected row as one lot."""
import cv2
import numpy as np


class ParcelFinder:
    def __init__(self, image):
        self.image = image
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        yellow = cv2.inRange(hsv, (15, 40, 150), (45, 255, 255))
        pink = cv2.inRange(hsv, (155, 40, 130), (179, 255, 255))
        self.mask = yellow | pink
        self.edges = cv2.Canny(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), 40, 100)

    def polygon(self, box, other_centers=()):
        box = np.asarray(box, dtype=np.float32)
        center = box.mean(axis=0)
        vectors = np.roll(box, -1, axis=0) - box
        lengths = np.linalg.norm(vectors, axis=1)
        index = int(np.argmax(lengths))
        length, breadth = float(lengths[index]), float(min(lengths))
        if breadth < 2 or length < 5:
            return None
        direction = vectors[index] / length
        radius = int(min(320, max(100, length * 3)))
        height, width = self.mask.shape
        x0, y0 = max(0, int(center[0]) - radius), max(0, int(center[1]) - radius)
        x1, y1 = min(width, int(center[0]) + radius), min(height, int(center[1]) + radius)
        seed = center - (x0, y0)
        mask = self.mask[y0:y1, x0:x1].copy()
        # Standard Hough voting retains faint/dotted parallel dividers that
        # probabilistic segments miss. Ignore text-length lines and lines
        # crossing the label itself; use the nearest boundary on each side.
        lines = cv2.HoughLines(self.edges[y0:y1, x0:x1], 1, np.pi / 720,
                               max(18, int(length * 1.15)))
        sides = {-1: [], 1: []}
        for line in (() if lines is None else lines):
            rho, theta = line[0]
            normal = np.array((np.cos(theta), np.sin(theta)))
            if abs(float(normal @ direction)) > .2:
                continue
            if float(normal @ np.array((direction[1], -direction[0]))) < 0:
                normal, rho = -normal, -rho
            distance = float(normal @ seed - rho)
            if not breadth / 2 + 2 < abs(distance) < length * 2:
                continue
            sides[-1 if distance < 0 else 1].append((abs(distance), normal, rho))
        if sides[-1] and sides[1]:
            for candidates in sides.values():
                _, normal, rho = min(candidates, key=lambda item: item[0])
                a, v = normal * rho, np.array((-normal[1], normal[0])) * (radius * 4)
                cv2.line(mask, tuple(np.rint(a - v).astype(int)),
                         tuple(np.rint(a + v).astype(int)), 0, 2)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        matching = [c for c in contours if cv2.contourArea(c) > 150
                    and cv2.pointPolygonTest(c, tuple(map(float, seed)), False) >= 0]
        if not matching:
            return None
        contour = min(matching, key=cv2.contourArea)
        bx, by, bw, bh = cv2.boundingRect(contour)
        if bx <= 1 or by <= 1 or bx + bw >= mask.shape[1] - 1 or by + bh >= mask.shape[0] - 1:
            return None
        if cv2.contourArea(contour) > length * breadth * 12:
            return None
        contour = contour + np.array((x0, y0), dtype=np.int32)
        # Never move several codes to the centroid of a merged row.
        if any(np.linalg.norm(np.asarray(p) - center) > 4
               and cv2.pointPolygonTest(contour, tuple(map(float, p)), False) >= 0
               for p in other_centers):
            return None
        return cv2.approxPolyDP(contour, 1.5, True).reshape(-1, 2).tolist()


def locate_parcels(image, labels):
    finder = ParcelFinder(image)
    centers = [np.asarray(c['labelPolygon']).mean(axis=0) for c in labels]
    for item, center in zip(labels, centers):
        polygon = finder.polygon(item['labelPolygon'],
                                 [p for c, p in zip(labels, centers) if c['code'] != item['code']])
        item['x'], item['y'] = map(float, center)
        item['polygon'] = polygon
        if polygon:
            contour = np.asarray(polygon, dtype=np.int32)
            moments = cv2.moments(contour)
            if moments['m00']:
                x, y = moments['m10'] / moments['m00'], moments['m01'] / moments['m00']
                if cv2.pointPolygonTest(contour, (x, y), False) >= 0:
                    item['x'], item['y'] = x, y
    return labels
