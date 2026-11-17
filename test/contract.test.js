import test from 'node:test';
import assert from 'node:assert/strict';
import { startSource } from '../source/server.js';
import { parsePage, entryPath } from '../src/adapter.js';
import { SourceClient } from '../src/source-client.js';

const personal = /patientName|certificate|Synthetic/i;

async function observe(stage = 'opening', path = entryPath) {
  const source = await startSource(new URL('../fixtures/source.json', import.meta.url));
  try {
    source.publish(stage);
    return parsePage(await new SourceClient(source.url).read(path));
  } finally { await source.close(); }
}

test('source distinguishes explicit zero capacity from absent observations', async () => {
  const initial = (await observe()).records[0].attributes;
  const unavailable = (await observe('updated')).records[0].attributes;
  assert.equal(initial.remaining, 3);
  assert.equal(unavailable.remaining, 0);
  assert.equal(initial.department, unavailable.department);
  const source = await startSource(new URL('../fixtures/source.json', import.meta.url));
  try {
    source.failNext(entryPath, 503);
    assert.equal((await fetch(new URL(entryPath, source.url))).status, 503);
  } finally { await source.close(); }
});

test('adapter minimizes records to slot fields at the intake boundary without dropping them', async () => {
  const page = await observe();
  const record = page.records[0];
  assert.equal(record.sourceId, 'D1-am');
  assert.equal(record.label, 'D1');
  assert.deepEqual(Object.keys(record.attributes).sort(), ['date', 'department', 'observedAt', 'remaining', 'slotId']);
  assert.equal(record.attributes.remaining, 3);
  assert.ok(!personal.test(JSON.stringify(page)), '个人字段不得进入接入结果');
});

test('parse errors never echo page content', async () => {
  const source = await startSource(new URL('../fixtures/source.json', import.meta.url));
  try {
    source.publish('broken');
    const response = await new SourceClient(source.url).read(entryPath);
    assert.ok(personal.test(response.text), 'fixture 应包含个人字段以验证清洗');
    assert.throws(() => parsePage(response), (error) => {
      assert.equal(error.reason, 'parse-error');
      assert.ok(!personal.test(error.message), '错误信息不得包含页面内容');
      assert.ok(!personal.test(error.stack ?? ''), '堆栈文本不得包含页面内容');
      return true;
    });
  } finally { await source.close(); }
});
