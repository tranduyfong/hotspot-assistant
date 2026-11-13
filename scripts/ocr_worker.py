"""Bounded, local OCR. Results are proposals; the operator confirms the printed code."""
import json
import sys
from pathlib import Path
import re


def emit(type_, **fields):
    print(json.dumps(dict(type=type_, **fields), ensure_ascii=False), flush=True)


def codes_in(raw):
    text = str(raw).upper().replace('–', '-').replace('—', '-')
    text = re.sub(r'\s*-\s*', '-', text)
    return re.findall(r'(?<![A-ZĐ0-9])([A-ZĐ][A-ZĐ0-9.]*-\d+[A-ZĐ]?)(?![A-ZĐ0-9.-])', text)


def image_regions(image, size=1200, overlap=160):
    """Keep small labels at native resolution, including labels on tile seams."""
    height, width = image.shape[:2]
    for top in range(0, height, size - overlap):
        for left in range(0, width, size - overlap):
            yield left, top, image[top:min(top + size, height), left:min(left + size, width)]


def preprocessing(image, mode):
    import cv2
    if mode == 'original':
        return image
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    if mode == 'binary':
        return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                     cv2.THRESH_BINARY, 31, 9)
    return gray


def compact_lot(contour, text_box, point):
    """A long connected yellow street is not a single parcel."""
    import cv2
    import numpy as np
    edges = np.linalg.norm(np.roll(text_box, -1, axis=0) - text_box, axis=1)
    text_height = max(1., float(min(edges)))
    text_width = max(1., float(max(edges)))
    _, (w, h), _ = cv2.minAreaRect(contour)
    if max(w, h) > text_width * 3 or min(w, h) > text_height * 5:
        return False
    m = cv2.moments(contour)
    if not m['m00']:
        return False
    center = (m['m10'] / m['m00'], m['m01'] / m['m00'])
    return float(np.linalg.norm(np.array(center) - point)) <= text_height


def run():
    import cv2
    import numpy as np
    import torch
    import easyocr
    torch.set_num_threads(2)
    torch.set_num_interop_threads(2)
    download = '--download' in sys.argv
    body = {} if download else json.load(sys.stdin)
    models = Path(body.get('models', Path(__file__).resolve().parents[1] / '.data/models'))
    models.mkdir(parents=True, exist_ok=True)
    emit('progress', message='Nạp bộ nhận diện chữ cục bộ')
    reader = easyocr.Reader(['vi', 'en'], gpu=False, verbose=False,
                            model_storage_directory=str(models), download_enabled=download)
    if download:
        emit('result', candidates=[])
        return
    image = cv2.imread(body['image'])
    if image is None:
        raise ValueError('Không mở được vùng ảnh mặt bằng.')
    height, width = image.shape[:2]
    golden = body.get('project') == 'vinhomes-golden-city'
    known_codes = set(body.get('knownCodes') or [])
    # Yellow parcels provide independent geometric evidence for a label's anchor.
    lots = []
    if not golden:
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        yellow = cv2.inRange(hsv, (15, 40, 150), (45, 255, 255))
        contours, _ = cv2.findContours(yellow, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        lots = [c for c in contours if 300 < cv2.contourArea(c) < width * height * .08]
    results = []
    passes = [(angle, 'original') for angle in (0, -35, 55)]
    if golden:
        passes = [(angle, body.get('preprocessing', 'contrast')) for angle in (0, 90, -15, 15)]
    if body.get('angles') is not None:
        passes = [(angle, body.get('preprocessing', 'contrast')) for angle in body['angles']]
    for angle, mode in passes:
        emit('progress', message=f'Đọc mã trên ảnh, góc {angle}°')
        matrix = cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1)
        cosine, sine = abs(matrix[0, 0]), abs(matrix[0, 1])
        rw, rh = int(height * sine + width * cosine), int(height * cosine + width * sine)
        matrix[0, 2] += (rw - width) / 2
        matrix[1, 2] += (rh - height) / 2
        rotated = image if angle == 0 else cv2.warpAffine(image, matrix, (rw, rh), borderValue=(255, 255, 255))
        inverse = cv2.invertAffineTransform(matrix)
        labels = []
        regions = image_regions(rotated) if golden else [(0, 0, rotated)]
        for left, top, region in regions:
            if golden:
                emit('progress', message=f'OCR {angle} degrees: x={left}, y={top}')
            found = reader.readtext(preprocessing(region, mode), detail=1, paragraph=False, batch_size=8,
                                 canvas_size=2560, mag_ratio=float(body.get('magnification', 1.8 if golden else 1.0)),
                                 allowlist='ABCDEFGHIJKLMNOPQRSTUVWXYZĐ0123456789-.m²,',
                                 rotation_info=None)
            labels.extend((np.asarray(box) + [left, top], raw, confidence) for box, raw, confidence in found)
        for box, raw, confidence in labels:
            codes = codes_in(raw)
            if len(codes) != 1 or float(confidence) < .25:
                continue
            if known_codes and codes[0] not in known_codes:
                continue
            polygon = cv2.transform(np.array([box], dtype=np.float32), inverse)[0]
            x, y = polygon.mean(axis=0)
            if not (0 <= x < width and 0 <= y < height):
                continue
            matches = [c for c in lots if cv2.pointPolygonTest(c, (float(x), float(y)), False) >= 0]
            lot_polygon = None
            if not golden and len(matches) == 1 and compact_lot(matches[0], polygon, (x, y)):
                contour = matches[0]
                bx, by, bw, bh = cv2.boundingRect(contour)
                if bx <= 1 or by <= 1 or bx + bw >= width - 1 or by + bh >= height - 1:
                    continue
                moments = cv2.moments(contour)
                cx, cy = moments['m10'] / moments['m00'], moments['m01'] / moments['m00']
                if cv2.pointPolygonTest(contour, (float(cx), float(cy)), False) >= 0:
                    x, y = cx, cy
                lot_polygon = cv2.approxPolyDP(contour, 2, True).reshape(-1, 2).tolist()
            item = dict(code=codes[0], raw=raw, confidence=round(float(confidence), 4),
                        x=float(x), y=float(y), polygon=lot_polygon, angle=angle,
                        textBox=polygon.tolist(), positionSource='text' if lot_polygon is None else 'parcel',
                        preprocessing=mode, ocrVersion=3)
            existing = next((p for p in results if p['code'] == item['code'] and
                             (p['x']-x)**2 + (p['y']-y)**2 < 12**2), None)
            if existing:
                if existing['confidence'] < item['confidence']:
                    results.remove(existing)
                else:
                    continue
            results.append(item)
        if body.get('target') and any(p['code'] == body['target'] and p['confidence'] >= .9
                                      and p['polygon'] for p in results):
            emit('progress', message='Đã đọc được mã đích trong ô đất; chuẩn bị ảnh để duyệt')
            break
    emit('result', candidates=results)


if __name__ == '__main__':
    try:
        run()
    except Exception as exc:
        emit('error', message=str(exc))
        sys.exit(1)
