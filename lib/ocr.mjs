import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
export function ocrConfig() {
  const suffix = process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
  const candidates = [process.env.OCR_PYTHON, join(projectRoot, '.venv', suffix), join(projectRoot, '../parcel-studio/.venv', suffix)].filter(Boolean);
  const python = candidates.find(existsSync);
  const modelDirs = [process.env.OCR_MODELS, join(projectRoot, '.data/models'), join(projectRoot, '../parcel-studio/.data/output/models/easyocr')].filter(Boolean);
  const models = modelDirs.find(p => existsSync(join(p, 'craft_mlt_25k.pth')) && existsSync(join(p, 'latin_g2.pth')));
  return { python, models, ready: Boolean(python && models) };
}
export const OCR_VERSION = 3;
export function readLabels(imagePath, notify, signal, target, options = {}) {
  const config = ocrConfig();
  if (!config.ready) throw new Error('Chưa có OCR cục bộ. Chạy CAI_OCR.bat; hiện vẫn có thể chọn vị trí trực tiếp trên ảnh.');
  return new Promise((resolve, reject) => {
    const child = spawn(config.python, [join(projectRoot, 'scripts/ocr_worker.py')], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    let buffer = '', result, errorOutput = '';
    const cancel = () => child.kill();
    signal?.addEventListener('abort', cancel, { once: true });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stderr.on('data', text => { errorOutput = (errorOutput + text).slice(-2000); });
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let pos;
      while ((pos = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, pos); buffer = buffer.slice(pos + 1);
        try {
          const item = JSON.parse(line);
          if (item.type === 'progress') notify(item.message);
          if (item.type === 'result') result = item.candidates;
          if (item.type === 'error') errorOutput = item.message;
        } catch { /* Library diagnostics are not protocol messages. */ }
      }
    });
    child.on('error', reject);
    child.on('close', code => {
      signal?.removeEventListener('abort', cancel);
      if (signal?.aborted) return reject(new Error('Đã dừng dò mã.'));
      if (code !== 0 || !result) return reject(new Error(errorOutput || 'Không nhận được kết quả OCR.'));
      resolve(result);
    });
    child.stdin.end(JSON.stringify({ ...options, image: imagePath, models: config.models, target }));
  });
}
