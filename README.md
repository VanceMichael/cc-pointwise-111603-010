# 服务时段观察器

Node.js 本地数据接入项目。已有一次来源读取、结构化导入与操作查询，来源服务和业务存储独立，来源变化不会自动刷新本地集合。当前导入以 sourceId 保存最新观察；历史版本、完整批次、身份决策及恢复流程尚未纳入接入生命周期。

## 运行

需要 Node.js 22，无第三方包、远程服务或账户凭据。`npm test` 运行现有行为与本地接口测试；`npm run demo` 启动临时来源、读取首批并展示业务查询，结束时自动关闭监听并清理临时数据，通常两秒内完成。`npm start -- ingest` 从 `fixtures/records.json` 导入，`npm start -- query` 读取本地 `var/records.json`。演示数据不访问生产站点。

## 组件和数据

`source/server.js` 读取 `fixtures/source.json` 并监听随机回环端口。`startSource()` 返回 url、publish(stage)、failNext(path,status) 和 close()；publish 切换可观察来源版本而不修改业务仓库，failNext 可返回 503 或使用 disconnect 断开连接。它记录请求路径并支持来源 ETag/304。`src/source-client.js` 只接受同一回环来源；`src/adapter.js` 在接入边界做最小化解析，只保留 slotId/department/date/remaining/observedAt，个人字段与页面其余内容不进入解析结果，解析错误也不回引页面内容。`src/availability-import.js` 逐科室跟随 rel=next 完成整页覆盖，瞬时失败按安全类别重试；只有覆盖完整且可解析的科室才写入业务库并标记 confirmed，抓取或解析失败只把科室标记为 undetermined，不导入部分页面，也不推导 remaining=0。`src/diagnostics.js` 的 AttemptJournal 只持久化 resource 与安全采集状态（白名单序列化）；`src/collection-status.js` 持久化各科室覆盖状态。`src/service.js` 与 `src/repository.js` 维护持久集合；`src/operations.js` 是读取该集合的业务消费入口，导出最小化字段与各科室 confirmed/undetermined 覆盖状态，来源协议见 [CONTRACT.md](CONTRACT.md)。

状态目录属于运行产物。扩展导入时应保留现有 CLI 和现有集合查询能力；新增状态可以另行组织。测试可直接使用随机端口来源，不需要等待真实时间或接入外网。运行录制可用 test 和 demo，无需安装浏览器或外部数据库。

`npm start` 或 `npm start -- --help` 查看命令；原导入和查询使用显式的 ingest、query 动作。`npm run acceptance` 在临时目录中验证本地来源读取、全科室导入、重启回读、重放、抓取失败与确认零名额的区分，以及全部持久化产物不含个人字段，完成后清理临时状态。
