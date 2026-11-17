// 导出只保留名额计算所需字段；个人字段即使存在于历史记录也不导出。
const fields = ["slotId", "department", "date", "remaining", "observedAt"];

export async function readOperations(repository, coverageStatus = null) {
  const records = await repository.read();
  const departments = coverageStatus ? await coverageStatus.read() : {};
  return {
    product: "服务时段观察器",
    rows: records.map((record) => ({
      sourceId: record.sourceId,
      source: record.source,
      observedAt: record.observedAt,
      attributes: Object.fromEntries(fields.map((field) => [field, record.attributes[field] ?? null])),
    })),
    // 服务台据此区分“已确认”和“暂不可判定”；remaining=0 只来自确认观测，与抓取失败无关。
    coverage: Object.entries(departments).map(([department, entry]) => ({ department, ...entry })),
  };
}
