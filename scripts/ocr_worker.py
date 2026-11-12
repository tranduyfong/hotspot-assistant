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
    from parcels import locate_parcels
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
    results = []
    # Small source labels disappear when a whole large patch is downscaled.
    # Overlapping tiles retain their resolution and include vertical writing.
    for angle in ((-90, 0) if body.get('preferVertical') else (0, -90, -35, 55)):
        emit('progress', message=f'Đọc mã trên ảnh, góc {angle}°')
        matrix = cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1)
        cosine, sine = abs(matrix[0, 0]), abs(matrix[0, 1])
        rw, rh = int(height * sine + width * cosine), int(height * cosine + width * sine)
        matrix[0, 2] += (rw - width) / 2
        matrix[1, 2] += (rh - height) / 2
        rotated = cv2.warpAffine(image, matrix, (rw, rh), borderValue=(255, 255, 255))
        inverse = cv2.invertAffineTransform(matrix)
        tile_size, stride = 1200, 1000
        starts = lambda size: list(dict.fromkeys(min(p, max(0, size - tile_size))
                                                for p in range(0, size, stride)))
        tiles = [(x, y) for y in starts(rh) for x in starts(rw)]
        # Start with the densest parcel regions rather than empty scenery.
        def parcel_pixels(tile):
            x, y = tile
            hsv = cv2.cvtColor(rotated[y:y+tile_size, x:x+tile_size], cv2.COLOR_BGR2HSV)
            return int(np.count_nonzero(cv2.inRange(hsv, (15, 70, 150), (45, 255, 255))
                                       | cv2.inRange(hsv, (155, 40, 130), (179, 255, 255))))
        tiles = sorted(tiles, key=parcel_pixels, reverse=True)
        for tile_index, (tx, ty) in enumerate(tiles):
            if parcel_pixels((tx, ty)) < 1000:
                continue
            emit('progress', message=f'Đọc mã góc {angle}°, vùng {tile_index + 1}/{len(tiles)}')
            tile = rotated[ty:ty+tile_size, tx:tx+tile_size]
            horizontal, free = reader.detect(tile, canvas_size=2560, mag_ratio=2.0)
            # Area figures and individual letters are not product codes. Avoid
            # spending recognition time on hundreds of those small boxes.
            horizontal = [box for box in horizontal[0]
                          if box[1] - box[0] >= 20 and box[1] - box[0] >= 1.8 * (box[3] - box[2])]
            free = [box for box in free[0]
                    if max(np.linalg.norm(np.roll(np.array(box), -1, axis=0) - box, axis=1)) >= 20]
            emit('progress', message=f'Nhận diện {len(horizontal) + len(free)} nhãn mã, góc {angle}°, vùng {tile_index + 1}/{len(tiles)}')
            labels = reader.recognize(tile, horizontal_list=horizontal, free_list=free,
                                      detail=1, paragraph=False, batch_size=8,
                                      allowlist='ABCDEFGHIJKLMNOPQRSTUVWXYZĐ0123456789-.',
                                      rotation_info=[180])
            for box, raw, confidence in labels:
                add_label(results, box, raw, confidence, tx, ty, inverse, width, height, angle, cv2, np)
            locate_parcels(image, results)
            Path(body['image']).with_suffix('.ocr-progress.json').write_text(
                json.dumps(results, ensure_ascii=False), encoding='utf-8')
            target_matches = [p for p in results if p['code'] == body.get('target')]
            if target_matches:
                emit('progress', message=f"Đọc được {body['target']}: " + ', '.join(
                    f"{p['confidence']:.0%}, {'đã khoanh ô' if p['polygon'] else 'chưa tách được viền'}"
                    for p in target_matches))
            # These remain proposals for visual review, never automatic writes.
            if body.get('target') and any(p['code'] == body['target'] and p['confidence'] >= .6
                                          and p['polygon'] for p in results):
                emit('progress', message='Đã đọc được mã đích và khoanh riêng ô đất')
                emit('result', candidates=results)
                return
        if any(p['code'] == body.get('target') for p in results):
            emit('result', candidates=results)
            return
    emit('result', candidates=results)


def add_label(results, box, raw, confidence, tx, ty, inverse, width, height, angle, cv2, np):
    codes = codes_in(raw)
    if len(codes) != 1 or float(confidence) < .25:
        return
    points = np.array([box], dtype=np.float32) + np.array((tx, ty), dtype=np.float32)
    polygon = cv2.transform(points, inverse)[0]
    x, y = polygon.mean(axis=0)
    if not (0 <= x < width and 0 <= y < height):
        return
    item = dict(code=codes[0], raw=raw, confidence=round(float(confidence), 4),
                x=float(x), y=float(y), polygon=None, labelPolygon=polygon.tolist(), angle=angle)
    existing = next((p for p in results if p['code'] == item['code'] and
                     sum((np.array(p['labelPolygon']).mean(axis=0) - (x, y))**2) < 30**2), None)
    if existing:
        if existing['confidence'] < item['confidence']:
            results.remove(existing)
        else:
            return
    results.append(item)


if __name__ == '__main__':
    try:
        run()
    except Exception as exc:
        emit('error', message=str(exc))
        sys.exit(1)
