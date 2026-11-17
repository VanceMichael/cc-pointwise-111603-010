import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// 诊断条目只允许这些键：resource、安全采集状态与分类元数据。
// 白名单序列化保证即使调用方误传接收体或个人字段，也不会写入诊断文件。
const allowedKeys = ['resource', 'state', 'at', 'attempt', 'bytes', 'records', 'reason'];

function sanitizeAttempt(attempt) {
  return Object.fromEntries(allowedKeys.filter((key) => attempt[key] !== undefined).map((key) => [key, attempt[key]]));
}

export class AttemptJournal {
  constructor(path) { this.path = path; }

  async append(attempt) {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, JSON.stringify(sanitizeAttempt(attempt)) + '\n');
  }
}

// 把任意错误归约为安全的分类标记，保证状态文件、错误文本与日志不含页面内容。
export function reasonFor(error) {
  if (error && typeof error.reason === 'string') return error.reason;
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'source-timeout';
  if (/origin changed/.test(error?.message ?? '')) return 'source-origin-changed';
  const status = /^source (\d{3}): /.exec(error?.message ?? '')?.[1];
  if (status) return `source-${status}`;
  if (error instanceof TypeError) return 'source-unreachable';
  return 'collection-error';
}
