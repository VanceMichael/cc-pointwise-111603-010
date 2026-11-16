import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export class AttemptJournal {
  constructor(path) { this.path = path; }

  async append(attempt) {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, JSON.stringify(attempt) + '\n');
  }
}
