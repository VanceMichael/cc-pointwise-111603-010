const fields = ["slotId", "department", "date", "remaining", "observedAt", "patientName", "certificate"];

export async function readOperations(repository) {
  const records = await repository.read();
  return { product: "服务时段观察器", rows: records.map((record) => ({
    sourceId: record.sourceId,
    source: record.source,
    observedAt: record.observedAt,
    attributes: Object.fromEntries(fields.map((field) => [field, record.attributes[field] ?? null])),
  })) };
}
