import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startSource } from '../source/server.js';
import { SourceClient } from './source-client.js';
import * as adapter from './adapter.js';
import { RecordRepository } from './repository.js';
import { CollectionService } from './service.js';
import { readOperations } from './operations.js';
import { AttemptJournal } from './diagnostics.js';
import { CoverageStatus } from './collection-status.js';
import { importAvailability } from './availability-import.js';

const personal = /patientName|certificate|Synthetic/i;
const source = await startSource(new URL('../fixtures/source.json', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'collection-acceptance-'));
try {
  const client = new SourceClient(source.url);
  const recordsPath = join(directory, 'records.json');
  const journalPath = join(directory, 'attempts.jsonl');
  const statusPath = join(directory, 'collection-status.json');
  const repository = new RecordRepository(recordsPath);
  const service = new CollectionService(repository);
  const journal = new AttemptJournal(journalPath);
  const status = new CoverageStatus(statusPath);
  const collect = () => importAvailability(client, adapter, service, journal, { status });

  // 首次导入：两个科室均覆盖完整并确认
  const first = await collect();
  assert.equal(first.imported, 2);
  assert.equal(first.coverage.D1.state, 'confirmed');
  assert.equal(first.coverage.D2.state, 'confirmed');
  const stored = await repository.read();
  assert.equal(stored.length, 2);

  // 所有持久化产物（业务库、诊断日志、覆盖状态）都不含个人字段
  for (const path of [recordsPath, journalPath, statusPath]) {
    assert.ok(!personal.test(await readFile(path, 'utf8')), `${path} 不应包含个人字段`);
  }

  // 重启回读同一份业务记录
  const reopened = new RecordRepository(recordsPath);
  assert.deepEqual(await new CollectionService(reopened).query({}), stored, '重新打开后读取同一份业务记录');

  // 重放不重复保存
  await collect();
  assert.equal((await reopened.read()).length, stored.length, '重放采集不重复保存');

  // 抓取失败：科室暂不可判定，已确认数据保留，不推导为零名额
  for (let i = 0; i < 3; i += 1) source.failNext(adapter.entryPath, 503);
  const failed = await collect();
  assert.equal(failed.coverage.D1.state, 'undetermined');
  assert.equal(failed.coverage.D1.reason, 'source-503');
  assert.equal(failed.coverage.D2.state, 'confirmed');
  const afterFailure = await readOperations(reopened, status);
  const d1AfterFailure = afterFailure.rows.find((row) => row.attributes.department === 'D1');
  assert.equal(d1AfterFailure.attributes.remaining, 3, '抓取失败不得改写已确认名额');
  assert.equal(afterFailure.coverage.find((entry) => entry.department === 'D1').state, 'undetermined');
  assert.equal(afterFailure.coverage.find((entry) => entry.department === 'D2').state, 'confirmed');

  // 来源恢复并更新：确认零名额如实导出，与之前的失败状态明确区分
  source.publish('updated');
  const recovered = await collect();
  assert.equal(recovered.coverage.D1.state, 'confirmed');
  const view = await readOperations(reopened, status);
  const d1 = view.rows.find((row) => row.attributes.department === 'D1');
  assert.equal(d1.attributes.remaining, 0, '确认零名额应如实导出');
  assert.equal(view.coverage.find((entry) => entry.department === 'D1').state, 'confirmed');
  assert.ok(!personal.test(JSON.stringify(view)), '业务导出不应包含个人字段');

  console.log(JSON.stringify({
    accepted: first.imported,
    persisted: stored.length,
    replayStored: (await reopened.read()).length,
    operationRows: view.rows.length,
    coverage: view.coverage.map((entry) => `${entry.department}:${entry.state}`),
    status: 'ok',
  }));
} finally {
  await source.close();
  await rm(directory, { recursive: true, force: true });
}
