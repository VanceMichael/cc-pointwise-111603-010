import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { minimizeSlot } from '../src/adapter.js';
import { RecordRepository } from '../src/repository.js';
import { CollectionService } from '../src/service.js';
import { readOperations } from '../src/operations.js';
import { CoverageStatus } from '../src/collection-status.js';

const personal = /patientName|certificate|Synthetic/i;

test('adapter projection keeps every slot field and drops personal fields without dropping the record', () => {
  const slot = minimizeSlot({
    slotId: 'D1-am', department: 'D1', date: '2026-11-17', remaining: 0,
    observedAt: '2026-11-16T08:00:00Z', patientName: 'Synthetic', certificate: 'SYNTHETIC-1', internalNote: 'x',
  }, 0);
  assert.deepEqual(slot, {
    slotId: 'D1-am', department: 'D1', date: '2026-11-17', remaining: 0, observedAt: '2026-11-16T08:00:00Z',
  }, '记录本身保留，只投影掉与名额统计无关的字段');
});

test('adapter validation errors identify records by position and never echo values', () => {
  assert.throws(() => minimizeSlot({
    slotId: 'D1-am', department: 'D1', date: '2026-11-17', observedAt: '2026-11-16T08:00:00Z', patientName: 'Synthetic',
  }, 1), (error) => {
    assert.match(error.message, /record 1 missing remaining/);
    assert.ok(!personal.test(error.message));
    return true;
  });
  for (const [field, value] of [['remaining', -1], ['remaining', 1.5], ['remaining', '3'], ['date', '17/11/2026'], ['observedAt', 'soon']]) {
    assert.throws(() => minimizeSlot({
      slotId: 'D1-am', department: 'D1', date: '2026-11-17', remaining: 3, observedAt: '2026-11-16T08:00:00Z', [field]: value,
    }, 0), (error) => {
      assert.equal(error.reason, 'parse-error');
      assert.ok(!personal.test(error.message));
      return true;
    }, `invalid ${field} must be rejected`);
  }
});

test('operations export is minimized even when stored records carry personal fields', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'operations-'));
  try {
    const repository = new RecordRepository(join(directory, 'records.json'));
    await new CollectionService(repository).ingest([{
      sourceId: 'D1-am', source: '服务时段观察器', observedAt: '2026-11-16T08:00:00Z', label: 'D1',
      attributes: {
        slotId: 'D1-am', department: 'D1', date: '2026-11-17', remaining: 0,
        observedAt: '2026-11-16T08:00:00Z', patientName: 'Synthetic Legacy', certificate: 'SYNTHETIC-LEGACY',
      },
    }]);
    const view = await readOperations(repository);
    assert.equal(view.rows[0].attributes.remaining, 0, '确认零名额必须原样导出');
    assert.deepEqual(Object.keys(view.rows[0].attributes).sort(), ['date', 'department', 'observedAt', 'remaining', 'slotId']);
    assert.deepEqual(view.coverage, [], '没有覆盖状态存储时导出空覆盖列表');
    assert.ok(!personal.test(JSON.stringify(view)), '导出不得包含个人字段');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('coverage status persists per-department state across restarts and stays minimal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coverage-'));
  try {
    const path = join(directory, 'collection-status.json');
    const status = new CoverageStatus(path);
    await status.mark('D1', { state: 'confirmed', resource: '/availability?department=D1', at: '2026-11-17T01:00:00Z', slots: 2 });
    await status.mark('D2', { state: 'undetermined', resource: '/availability?department=D2', at: '2026-11-17T01:01:00Z', reason: 'source-503' });
    // 即使调用方误传个人字段或页面内容，落盘前也会被白名单剔除
    await status.mark('D3', { state: 'undetermined', resource: '/availability?department=D3', at: '2026-11-17T01:02:00Z',
      reason: 'parse-error', patientName: 'Synthetic', certificate: 'SYNTHETIC-1', body: '<html>Synthetic</html>' });
    const text = await readFile(path, 'utf8');
    assert.ok(!personal.test(text) && !text.includes('body'), '状态文件不得包含个人字段或页面内容');
    const reopened = new CoverageStatus(path);
    const departments = await reopened.read();
    assert.equal(departments.D1.state, 'confirmed');
    assert.equal(departments.D2.state, 'undetermined');
    assert.equal(departments.D2.reason, 'source-503');
    const view = await readOperations(new RecordRepository(join(directory, 'records.json')), reopened);
    assert.deepEqual(view.coverage.map((entry) => [entry.department, entry.state]),
      [['D1', 'confirmed'], ['D2', 'undetermined'], ['D3', 'undetermined']]);
    assert.ok(!personal.test(JSON.stringify(view)));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
