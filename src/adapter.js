export const entryPath = "/availability?department=D1";

export const entries = [
  { department: "D1", path: "/availability?department=D1" },
  { department: "D2", path: "/availability?department=D2" },
];

// 统计只需要这些字段；预约者个人字段在接入边界即被丢弃，不进入任何持久状态。
export const slotFields = Object.freeze(["slotId", "department", "date", "remaining", "observedAt"]);

function parseError(message) {
  return Object.assign(new Error(message), { reason: "parse-error" });
}

function parseRecordJson(text, index) {
  try {
    return JSON.parse(text);
  } catch {
    // 原始解析错误可能引用页面片段，页面里夹带个人字段，必须丢弃后重新归类。
    throw parseError(`source record ${index} is not valid JSON`);
  }
}

export function minimizeSlot(item, index) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw parseError(`source record ${index} is not an object`);
  }
  const slot = {};
  for (const field of slotFields) {
    if (!(field in item)) throw parseError(`source record ${index} missing ${field}`);
    slot[field] = item[field];
  }
  // 校验失败只按位置与字段名报告，不回引任何字段值。
  if (typeof slot.slotId !== "string" || !slot.slotId.trim()) throw parseError(`source record ${index} has invalid slotId`);
  if (typeof slot.department !== "string" || !slot.department.trim()) throw parseError(`source record ${index} has invalid department`);
  if (typeof slot.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(slot.date)) throw parseError(`source record ${index} has invalid date`);
  if (!Number.isInteger(slot.remaining) || slot.remaining < 0) throw parseError(`source record ${index} has invalid remaining`);
  if (typeof slot.observedAt !== "string" || !Number.isFinite(Date.parse(slot.observedAt))) throw parseError(`source record ${index} has invalid observedAt`);
  return slot;
}

export function parsePage(response) {
  const items = [...response.text.matchAll(/<script type="application\/json" class="source-record">([\s\S]*?)<\/script>/g)]
    .map((match, index) => parseRecordJson(match[1], index));
  if (!items.length) throw parseError("source layout contains no records");
  const next = response.text.match(/rel="next" href="([^"]+)"/)?.[1] ?? null;
  return { next, records: items.map((item, index) => {
    const slot = minimizeSlot(item, index);
    return {
      sourceId: slot.slotId,
      source: "服务时段观察器",
      observedAt: slot.observedAt,
      label: slot.department,
      attributes: slot,
    };
  }) };
}
