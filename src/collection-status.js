import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// 科室覆盖状态：confirmed 表示本次采集覆盖完整且可解析；undetermined 表示暂不可判定。
// 只持久化安全字段（state/resource/at/reason/slots），个人字段与页面内容一律不落盘。
const allowedKeys = ['state', 'resource', 'at', 'reason', 'slots'];

function sanitizeEntry(entry) {
  return Object.fromEntries(allowedKeys.filter((key) => entry[key] !== undefined).map((key) => [key, entry[key]]));
}

export class CoverageStatus {
  constructor(path) { this.path = path; }

  async read() {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value.departments) || typeof value.departments !== 'object' || value.departments === null) {
        throw new Error('coverage status file has no departments object');
      }
      return value.departments;
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  }

  async mark(department, entry) {
    const departments = await this.read();
    departments[department] = sanitizeEntry(entry);
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ departments }, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, this.path);
  }
}
