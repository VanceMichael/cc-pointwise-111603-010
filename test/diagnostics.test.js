import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startSource } from '../source/server.js';
import { SourceClient } from '../src/source-client.js';
import * as adapter from '../src/adapter.js';
import { AttemptJournal } from '../src/diagnostics.js';
import { importAvailability } from '../src/availability-import.js';
import { CollectionService } from '../src/service.js';
import { RecordRepository } from '../src/repository.js';

test('availability importer connects source, durable journal and stored rows', async () => {
  const source = await startSource(new URL('../fixtures/source.json', import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), 'availability-'));
  try {
    const journalPath = join(directory, 'attempts.jsonl');
    const repository = new RecordRepository(join(directory, 'records.json'));
    const count = await importAvailability(new SourceClient(source.url), adapter,
      new CollectionService(repository), new AttemptJournal(journalPath));
    assert.equal(count, 1);
    assert.equal((await repository.read()).length, 1);
    const attempt = JSON.parse((await readFile(journalPath, 'utf8')).trim());
    assert.equal(attempt.resource, adapter.entryPath);
    assert.equal(attempt.state, 'received');
  } finally { await source.close(); await rm(directory, { recursive: true, force: true }); }
});
