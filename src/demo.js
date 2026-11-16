import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startSource } from '../source/server.js';
import { SourceClient } from './source-client.js';
import { parsePage, entryPath } from './adapter.js';
import { RecordRepository } from './repository.js';
import { CollectionService } from './service.js';
import { readOperations } from './operations.js';
import { AttemptJournal } from './diagnostics.js';
import { importAvailability } from './availability-import.js';
import * as adapter from './adapter.js';

const source = await startSource(new URL('../fixtures/source.json', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'collection-demo-'));
try {
  const repository = new RecordRepository(join(directory, 'records.json'));
  await importAvailability(new SourceClient(source.url), adapter, new CollectionService(repository), new AttemptJournal(join(directory, 'attempts.jsonl')));
  console.log(JSON.stringify(await readOperations(repository), null, 2));
} finally { await source.close(); await rm(directory, { recursive: true, force: true }); }
