import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
export class Store {
  constructor(root) { this.root = root; this.data = { version: 1, approvals: {}, history: [] }; }
  async init() {
    await mkdir(this.root, { recursive: true });
    try { this.data = JSON.parse(await readFile(join(this.root, 'store.json'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw new Error('Không đọc được dữ liệu vị trí đã lưu. Giữ nguyên store.json để kiểm tra.'); }
  }
  async save() {
    const target = join(this.root, 'store.json');
    await writeFile(target + '.tmp', JSON.stringify(this.data, null, 2));
    await rename(target + '.tmp', target);
  }
  async log(action, details) {
    this.data.history.unshift({ at: new Date().toISOString(), action, ...details });
    this.data.history = this.data.history.slice(0, 300);
    await this.save();
  }
}
