# 来源与消费契约

## 来源

入口 `/availability?department=D1`，HTML 内的 source-record JSON 节点保留了门户输出字段；rel=next 链接表示下一页。`fixtures/source.json` 的 opening 与 updated 是两个可切换的来源观察，不代表业务库必须得出某个预设结论；可添加新的来源观察验证行为。

来源公开页面会混入与时段统计无关的预约者字段。统计只需 department/date/slotId/remaining 及采集覆盖；个人字段不应进入持久状态、错误文本、导出和日志。页面不可用不能推导 remaining=0，只有覆盖完整且可解析的观测才提供可用量。

## 业务消费

`readOperations(repository)` 当前返回 product 和 rows，每行带 sourceId/source/observedAt/attributes。现有 CLI 和结构化导入用于本地运维；新增采集结果也需要让业务读取入口看到一致状态，必要的解释信息可扩展返回。原始来源身份与 observedAt 不是通用的业务版本、完整性或成功证明。来源接口契约是兼容边界，采集、状态管理和新业务表达由实现决定。

## 采集诊断

`src/availability-import.js` 连接来源读取、AttemptJournal 与业务导入；目前诊断会在解析前记录接收体，故诊断数据和业务库是两条独立持久路径。后续回放依靠 resource 与安全的采集状态识别失败范围，不要求保存个人字段或完整页面。
