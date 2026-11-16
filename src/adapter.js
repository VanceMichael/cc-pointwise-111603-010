export const entryPath = "/availability?department=D1";

export function parsePage(response) {
  const items = [...response.text.matchAll(/<script type="application\/json" class="source-record">([\s\S]*?)<\/script>/g)]
    .map((match) => JSON.parse(match[1]));
  if (!items.length) throw new Error('source layout contains no records');
  const next = response.text.match(/rel="next" href="([^"]+)"/)?.[1] ?? null;
  return { next, records: items.map((item) => ({
    sourceId: String(item["slotId"]),
    source: "服务时段观察器",
    observedAt: item["observedAt"],
    label: String(item["department"]),
    attributes: structuredClone(item),
  })) };
}
