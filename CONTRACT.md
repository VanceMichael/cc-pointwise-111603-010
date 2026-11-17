# 来源与消费契约

## 来源

入口 `/availability?department=D1`，HTML 内的 source-record JSON 节点保留了门户输出字段；rel=next 链接表示下一页。`fixtures/source.json` 的 opening 与 updated 是两个可切换的来源观察，不代表业务库必须得出某个预设结论；可添加新的来源观察验证行为。

来源公开页面会混入与时段统计无关的预约者字段。统计只需 department/date/slotId/remaining 及采集覆盖；个人字段不应进入持久状态、错误文本、导出和日志。页面不可用不能推导 remaining=0，只有覆盖完整且可解析的观测才提供可用量。

## 业务消费

`readOperations(repository, coverageStatus)` 返回 product、rows 与 coverage。rows 每行带 sourceId/source/observedAt 和仅含 slotId/department/date/remaining/observedAt 的 attributes，个人字段即使存在于历史记录也不导出；coverage 逐科室给出 confirmed/undetermined、安全原因与最近采集时间，服务台据此区分已确认与暂不可判定。现有 CLI 和结构化导入用于本地运维；新增采集结果也需要让业务读取入口看到一致状态，必要的解释信息可扩展返回。原始来源身份与 observedAt 不是通用的业务版本、完整性或成功证明。来源接口契约是兼容边界，采集、状态管理和新业务表达由实现决定。

## 采集诊断

`src/availability-import.js` 连接来源读取、AttemptJournal、覆盖状态与业务导入。诊断日志只记录 resource、安全采集状态（received/retry/failed/imported/undetermined）与分类原因，不保存接收体、个人字段或原始错误文本；`src/collection-status.js` 持久化各科室 confirmed/undetermined 状态。回放依靠 resource 与安全状态识别失败范围，不需要个人字段或完整页面。抓取或解析失败只产生 undetermined；部分页面失败时整科室不导入，只有覆盖完整且可解析的观测才进入业务库。
