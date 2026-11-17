import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startSource } from '../source/server.js';
import { SourceClient } from '../src/source-client.js';
import * as adapter from '../src/adapter.js';
import { AttemptJournal, reasonFor } from '../src/diagnostics.js';
import { CoverageStatus } from '../src/collection-status.js';
import { importAvailability } from '../src/availability-import.js';
import { CollectionService } from '../src/service.js';
import { RecordRepository } from '../src/repository.js';

const personal = /patientName|certificate|Synthetic/i;

async function setup() {
  const source = await startSource(new URL('../fixtures/source.json', import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), 'availability-'));
  const journalPath = join(directory, 'attempts.jsonl');
  const statusPath = join(directory, 'collection-status.json');
  const repository = new RecordRepository(join(directory, 'records.json'));
  const status = new CoverageStatus(statusPath);
  const run = (options = {}) => importAvailability(new SourceClient(source.url), adapter,
    new CollectionService(repository), new AttemptJournal(journalPath), { status, ...options });
  const cleanup = async () => { await source.close(); await rm(directory, { recursive: true, force: true }); };
  return { source, repository, journalPath, statusPath, run, cleanup };
}

async function journalEntries(path) {
  return (await readFile(path, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
}

test('availability importer connects source, durable journal and stored rows', async () => {
  const { repository, journalPath, run, cleanup } = await setup();
  try {
    const summary = await run();
    assert.equal(summary.imported, 2);
    assert.equal((await repository.read()).length, 2);
    assert.equal(summary.coverage.D1.state, 'confirmed');
    assert.equal(summary.coverage.D2.state, 'confirmed');
    const entries = await journalEntries(journalPath);
    const received = entries.find((entry) => entry.state === 'received' && entry.resource === adapter.entryPath);
    assert.ok(received, 'journal records the received page');
    assert.ok(!('body' in received), 'journal must not persist page bodies');
    assert.ok(!personal.test(JSON.stringify(entries)), 'journal must not contain personal fields');
  } finally { await cleanup(); }
});

test('journal drops unexpected fields instead of persisting them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'journal-'));
  try {
    const journalPath = join(directory, 'attempts.jsonl');
    const journal = new AttemptJournal(journalPath);
    await journal.append({ resource: '/availability?department=D1', state: 'received', at: '2026-11-17T00:00:00Z',
      body: '<html>Synthetic</html>', patientName: 'Synthetic', certificate: 'SYNTHETIC-1' });
    const text = await readFile(journalPath, 'utf8');
    assert.ok(!personal.test(text) && !text.includes('body'), 'journal file must not contain personal fields or bodies');
    const entry = JSON.parse(text.trim());
    assert.deepEqual(Object.keys(entry).sort(), ['at', 'resource', 'state']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('reasonFor reduces arbitrary errors to safe category tokens', () => {
  assert.equal(reasonFor(new Error('source 503: /availability?department=D1')), 'source-503');
  assert.equal(reasonFor(Object.assign(new Error('anything'), { reason: 'parse-error' })), 'parse-error');
  assert.equal(reasonFor(new TypeError('fetch failed')), 'source-unreachable');
  assert.equal(reasonFor(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), 'source-timeout');
  assert.equal(reasonFor(new Error('source origin changed')), 'source-origin-changed');
  assert.equal(reasonFor(new Error('something else')), 'collection-error');
});

test('transient source failure is retried and journaled with a safe reason', async () => {
  const { source, journalPath, run, cleanup } = await setup();
  try {
    source.failNext(adapter.entryPath, 503);
    const summary = await run();
    assert.equal(summary.coverage.D1.state, 'confirmed', 'transient failure heals on retry');
    const entries = await journalEntries(journalPath);
    const retry = entries.find((entry) => entry.state === 'retry');
    assert.equal(retry.resource, adapter.entryPath);
    assert.equal(retry.reason, 'source-503');
    assert.ok(!personal.test(JSON.stringify(entries)));
  } finally { await cleanup(); }
});

test('persistent fetch failure marks the department undetermined without fabricating slots', async () => {
  const { source, repository, journalPath, statusPath, run, cleanup } = await setup();
  try {
    await run();
    for (let i = 0; i < 3; i += 1) source.failNext(adapter.entryPath, 503);
    const summary = await run();
    assert.equal(summary.coverage.D1.state, 'undetermined');
    assert.equal(summary.coverage.D1.reason, 'source-503');
    assert.equal(summary.coverage.D2.state, 'confirmed', 'failure stays scoped to its own department');
    const d1 = (await repository.read()).find((record) => record.attributes.department === 'D1');
    assert.equal(d1.attributes.remaining, 3, 'fetch failure must not rewrite confirmed capacity to zero');
    const persisted = JSON.parse(await readFile(statusPath, 'utf8'));
    assert.equal(persisted.departments.D1.state, 'undetermined');
    assert.equal(persisted.departments.D2.state, 'confirmed');
    for (const path of [statusPath, journalPath]) {
      assert.ok(!personal.test(await readFile(path, 'utf8')), `${path} must not contain personal fields`);
    }
  } finally { await cleanup(); }
});

test('disconnect is categorized without leaking content', async () => {
  const { source, run, cleanup } = await setup();
  try {
    for (let i = 0; i < 3; i += 1) source.failNext(adapter.entryPath, 'disconnect');
    const summary = await run();
    assert.equal(summary.coverage.D1.state, 'undetermined');
    assert.equal(summary.coverage.D1.reason, 'source-unreachable');
  } finally { await cleanup(); }
});

test('parse failure is sanitized in summary, journal and status file', async () => {
  const { source, journalPath, statusPath, run, cleanup } = await setup();
  try {
    source.publish('broken');
    const summary = await run();
    assert.equal(summary.coverage.D1.state, 'undetermined');
    assert.equal(summary.coverage.D1.reason, 'parse-error');
    assert.equal(summary.coverage.D2.state, 'confirmed');
    assert.ok(!personal.test(JSON.stringify(summary)), 'summary must not echo page content');
    for (const path of [journalPath, statusPath]) {
      assert.ok(!personal.test(await readFile(path, 'utf8')), `${path} must not echo page content`);
    }
  } finally { await cleanup(); }
});

test('department is confirmed only after all pages are covered', async () => {
  const { source, repository, journalPath, run, cleanup } = await setup();
  try {
    source.publish('paged');
    const summary = await run();
    assert.equal(summary.coverage.D1.state, 'confirmed');
    assert.equal(summary.coverage.D1.slots, 2);
    const ids = (await repository.read()).map((record) => record.sourceId).sort();
    assert.deepEqual(ids, ['D1-am', 'D1-noon', 'D2-pm']);
    const entries = await journalEntries(journalPath);
    assert.ok(entries.some((entry) => entry.state === 'received' && entry.resource === '/availability?department=D1&page=2'));
  } finally { await cleanup(); }
});

test('a failed later page discards the whole department batch instead of importing partial coverage', async () => {
  const { source, repository, run, cleanup } = await setup();
  try {
    source.publish('paged');
    for (let i = 0; i < 3; i += 1) source.failNext('/availability?department=D1&page=2', 503);
    const summary = await run();
    assert.equal(summary.coverage.D1.state, 'undetermined');
    assert.equal(summary.coverage.D2.state, 'confirmed');
    const stored = await repository.read();
    assert.ok(!stored.some((record) => record.attributes.department === 'D1'),
      'partial page data must not enter the store, otherwise missing slots look like zero capacity');
  } finally { await cleanup(); }
});
