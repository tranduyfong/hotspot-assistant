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
    # Yellow parcels provide independent geometric evidence for a label's anchor.
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    yellow = cv2.inRange(hsv, (15, 40, 150), (45, 255, 255))
    contours, _ = cv2.findContours(yellow, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    lots = [c for c in contours if 300 < cv2.contourArea(c) < width * height * .08]
    results = []
    for angle in (0, -35, 55):
        emit('progress', message=f'Đọc mã trên ảnh, góc {angle}°')
        matrix = cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1)
        cosine, sine = abs(matrix[0, 0]), abs(matrix[0, 1])
        rw, rh = int(height * sine + width * cosine), int(height * cosine + width * sine)
        matrix[0, 2] += (rw - width) / 2
        matrix[1, 2] += (rh - height) / 2
        rotated = cv2.warpAffine(image, matrix, (rw, rh), borderValue=(255, 255, 255))
        inverse = cv2.invertAffineTransform(matrix)
        labels = reader.readtext(rotated, detail=1, paragraph=False, batch_size=8,
                                 canvas_size=2560, mag_ratio=1.0,
                                 allowlist='ABCDEFGHIJKLMNOPQRSTUVWXYZĐ0123456789-.m²,',
                                 rotation_info=None)
        for box, raw, confidence in labels:
            codes = codes_in(raw)
            if len(codes) != 1 or float(confidence) < .25:
                continue
            polygon = cv2.transform(np.array([box], dtype=np.float32), inverse)[0]
            x, y = polygon.mean(axis=0)
            if not (0 <= x < width and 0 <= y < height):
                continue
            matches = [c for c in lots if cv2.pointPolygonTest(c, (float(x), float(y)), False) >= 0]
            lot_polygon = None
            if len(matches) == 1:
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
                        x=float(x), y=float(y), polygon=lot_polygon, angle=angle)
            existing = next((p for p in results if p['code'] == item['code'] and
                             (p['x']-x)**2 + (p['y']-y)**2 < 60**2), None)
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
