import { reasonFor } from './diagnostics.js';

const now = () => new Date().toISOString();

function departmentOf(entry) {
  if (entry.department) return entry.department;
  const match = /[?&]department=([^&]+)/.exec(entry.path);
  return match ? decodeURIComponent(match[1]) : entry.path;
}

async function readWithRetry(client, resource, journal, attempts) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await client.read(resource);
      await journal.append({ resource, state: 'received', at: now(), attempt, bytes: response.text.length });
      return response;
    } catch (error) {
      const reason = reasonFor(error);
      const final = attempt >= attempts;
      await journal.append({ resource, state: final ? 'failed' : 'retry', at: now(), attempt, reason });
      if (final) throw Object.assign(new Error(`collection failed for ${resource}: ${reason}`), { reason });
    }
  }
}

async function collectDepartment(client, adapter, journal, entry, settings) {
  const records = [];
  const seen = new Set();
  let resource = entry.path;
  while (resource) {
    if (seen.has(resource) || seen.size >= settings.maxPages) {
      throw Object.assign(new Error(`pagination incomplete for ${entry.path}`), { reason: 'coverage-incomplete' });
    }
    seen.add(resource);
    const response = await readWithRetry(client, resource, journal, settings.attempts);
    let page;
    try {
      page = adapter.parsePage(response);
    } catch (error) {
      await journal.append({ resource, state: 'failed', at: now(), reason: reasonFor(error) });
      throw error;
    }
    records.push(...page.records);
    resource = page.next;
  }
  return records;
}

// 逐科室采集：覆盖完整且可解析才写入业务库并标记 confirmed；
// 抓取或解析失败只把科室标记为 undetermined，不导入部分页面，也不推导 remaining=0。
export async function importAvailability(client, adapter, service, journal, options = {}) {
  const settings = { attempts: options.attempts ?? 3, maxPages: options.maxPages ?? 25 };
  const entries = adapter.entries ?? [{ department: null, path: adapter.entryPath }];
  const coverage = {};
  let imported = 0;
  for (const entry of entries) {
    const department = departmentOf(entry);
    let records;
    try {
      records = await collectDepartment(client, adapter, journal, entry, settings);
    } catch (error) {
      const reason = reasonFor(error);
      coverage[department] = { state: 'undetermined', resource: entry.path, at: now(), reason };
      await journal.append({ resource: entry.path, state: 'undetermined', at: now(), reason });
      if (options.status) await options.status.mark(department, coverage[department]);
      continue;
    }
    await service.ingest(records);
    imported += records.length;
    coverage[department] = { state: 'confirmed', resource: entry.path, at: now(), slots: records.length };
    await journal.append({ resource: entry.path, state: 'imported', at: now(), records: records.length });
    if (options.status) await options.status.mark(department, coverage[department]);
  }
  return { imported, coverage };
}
