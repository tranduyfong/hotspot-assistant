"""Match source map pixels to a VHUB screenshot, independent of marker positions."""
import json
import sys
import cv2
import numpy as np

def register(body):
    source = cv2.imread(body['source'], cv2.IMREAD_GRAYSCALE)
    screen = cv2.imread(body['screen'], cv2.IMREAD_GRAYSCALE)
    if source is None or screen is None:
        raise ValueError('Cannot read registration images')
    detector = cv2.SIFT_create(nfeatures=15000)
    mask = np.zeros(screen.shape, np.uint8)
    for r in body['regions']:
        x, y, w, h = [int(r[k]) for k in ('x', 'y', 'width', 'height')]
        mask[max(0,y):max(0,y+h), max(0,x):max(0,x+w)] = 255
    ka, da = detector.detectAndCompute(source, None)
    kb, db = detector.detectAndCompute(screen, mask)
    if da is None or db is None:
        raise ValueError('No image features available')
    matches = [a for pair in cv2.BFMatcher().knnMatch(da, db, k=2)
               if len(pair) == 2 for a, b in [pair] if a.distance < .65 * b.distance]
    if len(matches) < 40:
        raise ValueError('Not enough independent image matches')
    a = np.float32([ka[m.queryIdx].pt for m in matches])
    b = np.float32([kb[m.trainIdx].pt for m in matches])
    fit, mask = cv2.estimateAffinePartial2D(a, b, method=cv2.RANSAC,
        ransacReprojThreshold=3, maxIters=10000)
    if fit is None:
        raise ValueError('Image registration failed')
    a, b = a[mask[:, 0] == 1], b[mask[:, 0] == 1]
    scale = np.hypot(fit[0, 0], fit[0, 1])
    if len(a) < 40 or not .2 < scale < 20 or abs(fit[0, 1]) > .02 * scale:
        raise ValueError('Unreliable image registration')
    if np.ptp(a[:, 0]) < 100 or np.ptp(a[:, 1]) < 100:
        raise ValueError('Image matches cover too small an area')
    # Spatially distributed held-out points are never used to fit this model.
    order = np.lexsort((a[:, 0], a[:, 1]))
    a, b = a[order], b[order]
    train = np.arange(len(a)) % 3 != 0
    fit, _ = cv2.estimateAffinePartial2D(a[train], b[train], method=cv2.LMEDS)
    errors = np.linalg.norm(cv2.transform(a[None], fit)[0] - b, axis=1) / scale
    validation = errors[~train]
    if np.quantile(validation, .95) > 1.5:
        raise ValueError('Held-out image alignment exceeds 1.5 source pixels')
    return {'pairs': [{'image': p.tolist(), 'screen': q.tolist()} for p, q in zip(a, b)],
            'matchedFeatures': len(a), 'validationCount': int((~train).sum()),
            'validationP95': float(np.quantile(validation, .95)),
            'validationRms': float(np.sqrt(np.mean(validation ** 2)))}

if __name__ == '__main__':
    try:
        print(json.dumps(register(json.load(sys.stdin))))
    except Exception as error:
        print(json.dumps({'error': str(error)}))
        sys.exit(1)
