# my-coffee 部署架构设计（方案二：FC + RDS PostgreSQL）

> 阶段：**方案设计阶段产出物**，待 CR(@agent-gtuw85fn) review + TL(@agent-8f7cny5f) 验收通过后才进入实现。
> 状态：**未执行**。RDS PostgreSQL 实例就绪前仅定方案，不部署、不迁移。
> 对应 TL 验收清单第 1 项；CR 硬约束（优雅关闭顺序、连接池数学）逐条落地。

## 一、形态决策：单函数整体上 FC

诉求"web+server+db 整体上 FC"。决策：**一个 FC3 custom-container 函数同时托管 API 与前端静态**，DB 用 RDS PostgreSQL（NAS 不用——方案三的 NFS 锁风险已排除）。

- 不做前后端分离成两个 FC 函数：前端是纯静态，Express `static` 即可托管，单函数=单部署单元，符合"整体上 FC"+最小复杂度（CR 复杂度预算）。
- 不做 OSS+CDN 托管前端：本期流量与"整体上 FC"诉求下，bundle 进容器最简；OSS+CDN 作为后续静态加速的可选项记录，不在本期引入。
- DB 不落 FC 本地盘：FC 实例无状态/临时，SQLite 本地会丢数据+并发不一致（已与 PM/TL/后端/CR 一致确认）→ DB 必须外置到 RDS PostgreSQL。

## 二、架构拓扑

```
            外网用户
              │ HTTPS
              ▼
   ┌───────────────────────────────┐
   │ FC3 HTTP 触发器（免 ICP 域名）   │  *.fcapp.run 默认免 ICP；可绑自定义域+HTTPS
   └───────────────┬───────────────┘
                   │ 同 VPC 内网
   ┌───────────────▼───────────────┐
   │ FC custom-container 函数       │
   │  node:20 + Express(fc-server.js)│
   │  ├─ /api/*  → 后端 routes       │
   │  └─ /      → 前端 Vite 静态     │
   │  instanceConcurrency = 10       │
   │  maximumInstanceCount = 20(硬上限)│
   │  connection_limit = 3(Prisma)   │
   └───────────────┬───────────────┘
                   │ VPC 内网 :5432（安全组仅放行 FC→RDS）
   ┌───────────────▼───────────────┐
   │ RDS PostgreSQL 16.13（VPC 内网实例，实测版本）│
   │  max_connections = 2420(实测真值)│
   └───────────────────────────────┘
```

镜像：`Dockerfile.fc` 多阶段构建（后端 tsc + 前端 vite build → 生产镜像），推 ACR **VPC 端点**，FC 从 ACR VPC 拉镜像（不走公网）。

## 三、FC↔RDS 网络与凭证注入

- **VPC 配置**：FC 函数配置 `vpcConfig`（VPC ID + vSwitch ID + 安全组），与 RDS **同 VPC**。这是 FC 访问 RDS 内网的前提。
- **安全组**：RDS 白名单/安全组仅放行 FC 函数所在安全组的 5432 入向；FC 函数绑独立安全组，不出公网。
- **连接串注入**：`DATABASE_URL=postgresql://<user>:<pass>@<rds-vpc-内网地址>:5432/<db>?connection_limit=3` 通过 FC 函数**环境变量**注入（控制台/s.yaml 配置，不进镜像、不进仓库、不进日志）。凭证只走仓库外 `.env`（source）或 FC 控制台 env，不硬编码。
- **其他 env**：`NODE_ENV=production`、`PORT=9000`（FC 注入 `CAPort`，fc-server.js 读 `CAPort || PORT || 9000`）、`FRONTEND_DIST=/app/frontend-dist`。`connection_limit=3` 不另设 env——钉在 `DATABASE_URL` 串尾（单一事实源，Prisma 从 datasource URL 读，见 §5 注入机制段；A2 否决独立 env 读取，避免双源漂移）。

## 四、免 ICP 域名 + HTTPS

- FC3 HTTP 触发器，`authType=anonymous`（或按需鉴权），methods 全开。
- 默认域名 `https://<account>.<region>.fcapp.run` **免 ICP**，可直接对外。
- 需自定义域：FC 控制台绑自定义域 + 自动 HTTPS 证书；自定义域若指向境内需 ICP，本期优先用 fcapp.run 免备案域名。

## 五、连接池共享策略（CR 第 3 条门禁 + 跨角色数学）

### 决策
- **本期上线（基线，必做）**：每实例 Prisma `connection_limit` + 压低 FC `instanceConcurrency`。不引入额外 pooler 服务。
- **扩容路径（按需启用，不本期预建）**：阿里云 **RDS 数据库代理（RDS Proxy）**。当实例数×连接池接近 RDS 上限时启用，FC 改连 Proxy 端点，后端连接被代理复用。这是后端 @agent-rhx6ueqf 所说"多短命实例打满 RDS 的根本解"，但**不提前引入**（CR 复杂度预算：不为假想流量加组件）。

### 连接池数学（CR 硬验收项：具体数字）
```
最大并发 FC 实例数（硬上限） × Prisma connection_limit ≤ RDS max_connections（留 ≥30% 余量）
```
本期取值：

| 参数 | 值 | 来源/责任 |
| --- | --- | --- |
| Prisma `connection_limit` | **3** | 后端数据层设计（@agent-rhx6ueqf）——须与本表一致 |
| FC `instanceConcurrency` | **10** | 部署侧（@agent-tex33crm，s.yaml） |
| 最大并发实例数（硬上限） | **20**（s.yaml `maximumInstanceCount=20` 钉死） | 部署侧配置值，非假设（CR ② 必改项） |
| 单实例最大连接 | 3 | = connection_limit |
| 总最大连接 | 20 × 3 = **60** | — |
| RDS `max_connections` | **2420**（实测真值，2026-07-21 沙箱直连 `SHOW max_connections`） | C3 门禁 ⑤ 真值半边已解（@agent-8f7cny5f 实测，水位 14） |
| 余量 | 60 / 2400 ≈ 2.5% 占用 → 97.5% 余量（40×） | max_connections=2420、`superuser_reserved_connections=20`（实测）→ 有效可用 2400；余量极充足，本期无需 RDS Proxy；仅当后续 RDS 缩容下调真值或硬上限上调致 60 逼近有效可用时启用 |

**最大实例数必须是配置值，不是假设（CR ②）**：FC 默认弹性伸缩，若实例数无硬上限，流量打满无节制扩实例终会 807×3=2421 > 2420 触顶，数学账崩（807 实例对咖啡点单不现实，但硬上限把"留给流量/规格变动的余量被侵蚀"的缝封死）。故 `maximumInstanceCount=20` 写入 s.yaml 钉死——让 60≤2420 成为定理（40× 余量，余量极充足）。部署时以 FC3 API/控制台实际字段为准（字段名可能为 `maximumInstanceCount` 或经控制台等价设置），关键是实例数确有 20 硬上限；若 fc3 component 不直接接受该 prop，部署后用控制台或 UpdateFunction 补设等价效果。

> **Drift 注（见 §七）**：`maximumInstanceCount=20` 在 FC3.0 schema 无 flat 字段（CreateFunctionInput / UpdateFunctionInput / PutScalingConfigInput 均无，SDK `@alicloud/fc20230330` 实核），`maxInstances` 只在 `PutScalingConfig` 的 `horizontalScalingPolicies[].ScalingPolicy` 内（需 auto-scaling rule: metric+target，非简单 cap）。`{"maximumInstances":20}` 大概率 InvalidParameter（schema）非 AccessDenied（policy）。scaling=运维策略非部署步骤，03 降 no-op+报账 log，折进 TODO v2 走通报前控制台人定（与删 `cr:CreateRepository` / repo ARN 收窄 / OSS 语句整块删 / FC trigger ARN 子路径补授 `functions/my-coffee-proxy/triggers/*` 同批五件，@aidbs-demo 走通报前合并办）。**审定值 20 硬账不丢**（zgn7xu3x），走通报 gate 核 scaling=❌「未定义 FC3.0 schema 故」非 AccessDenied 非全绿；04/C4 不 gate 此项（正交）。

**pool(3) < concurrency(10) 是有意排队，非碰巧（CR ②）**：单实例 10 并发只有 3 条 DB 连接，峰值最多 7 个请求在池上排队等。连接是稀缺资源、排队是正确行为，本期咖啡点单流量下接受此选择；最坏排队深度 7。若实测 DB 延迟成为主导，上调 `connection_limit` 至 5（20×5=100 仍 ≤2420，余量极充足）——这是有意识的调参旋钮，不是"碰巧选了 3"。**注意 2420 是本实例实测值、非普适常数**——RDS 实例规格变则真值变（缩容/换规格族都会动它）。上调 `connection_limit` 前先 `SHOW max_connections` 核实例当前真值，确保「实例数×connection_limit」仍留余量；方法论（总连接 ≤ 真值、留 ≥30% 余量）不变，变的是真数。

**跨角色交叉校验**：后端数据层设计的 `connection_limit` 必须等于本表的 **3**；若后端拟取不同值，两份设计对不上 = 设计不通过（TL 验收项）。`instanceConcurrency=10` 由本设计固定，后端不另设。

**注入机制（A2 @agent-rhx6ueqf 已定，A1 对齐）**：`connection_limit=3` 钉在 `DATABASE_URL` 串尾 `?connection_limit=3`，Prisma 从 datasource URL 读取（单一事实源）。s.yaml/env.example **不另设 `CONNECTION_LIMIT` env**——两处定义同一事实会静默漂移（A2 否决独立 env 读取）。env.example 的 `RDS_DATABASE_URL` 占位已含 `?connection_limit=3`，s.yaml 仅注入 `DATABASE_URL`，无 `CONNECTION_LIMIT` env 项。

**启用 RDS Proxy 的触发阈值**：`最大并发实例数 × 3 > 0.7 × RDS max_connections`，或实测 RDS 连接使用率 > 70%。届时 FC `DATABASE_URL` 改指向 Proxy 端点、后端 connection_limit 可上调，连接被代理多路复用。

## 六、容器优雅关闭（CR 正确性约束：先关 HTTP 再断 DB）

fc-server.js 实现 CR 指定的精确顺序：

```
SIGTERM/SIGINT → server.close()（拒新连接）→ drain 存量请求（带超时）→ prisma.$disconnect()（断 DB，自带超时）→ process.exit(0)
```

- `server.close()` 先于 `$disconnect()`：避免 drain 中的请求拿到已断开的 DB 连接（CR 指出反过来是正确性 bug）。
- **总预算 < FC 宽限期（CR ①）**：`SHUTDOWN_TIMEOUT_MS`（默认 8s）是优雅关闭**总预算**，必须短于 FC 平台 SIGTERM→SIGKILL 宽限期（custom-container 默认约 10-15s，部署时以平台实际值为准）。内部拆为 drain 预算 + disconnect 预算（`DRAIN_BUDGET_MS = SHUTDOWN_TIMEOUT_MS - DISCONNECT_BUDGET_MS`），drain 用余下预算、disconnect 用独立切片，保证 drain + disconnect 串行总耗时 ≤ SHUTDOWN_TIMEOUT_MS < FC grace。否则 drain 占满宽限期、平台 SIGKILL 强杀，优雅关闭是自欺。
- **`$disconnect()` 自带超时兜底（CR ②）**：`Promise.race([$disconnect(), setTimeout(DISCONNECT_BUDGET_MS)])`，挂死在 disconnect 上的 shutdown 不叫优雅。
- **SIGINT 同链路（CR ③）**：SIGTERM（FC 平台回收）与 SIGINT（本地/手动）走同一 shutdown。
- **入口只做 server 生命周期，不重复路由装配（CR ④）**：fc-server.js `require("./dist/app").createApp()` 复用后端既有 app（所有 `/api/*` 业务路由在 `app.ts` 装配一处），入口仅叠加前端静态托管 + SPA 回落（部署层职责，非业务路由），不存在两份真相。

具体实现见 `fc-server.js`。

## 七、镜像与部署流程（设计，未执行）

镜像：`Dockerfile.fc` → `<ACR VPC>/<ns>/my-coffee-fc:<git-sha>`。
脚本链（设计模板，待设计通过+RDS 就绪后执行）：

```
01-build-images  本地 docker build → tag=git sha
02-push-acr      acr_token → docker login ACR VPC → push 镜像
03-fc-deploy     s deploy（s.yaml）部署/更新 FC 函数；FC 从 ACR VPC 拉镜像；幂等可重跑
04-healthcheck   curl FC 免ICP 域名 /api/health + /api/menu + /；校验镜像 tag
```

> **Drift 注（2026-07-22 实跑后补，PM plan-sync per CR wtrwqdzj 路由 / CR🟢 95us6nem 重审 + 真跑 CreateFunction green 实证 nr4uzthr）**：03 部署机制经三段 pivot 落定，与本节原「`s deploy（s.yaml）`」表述 drift 如下——
>
> 1. **原 `s deploy`（s.yaml）→ 弃**。root cause：`s 3.1.10`/`fc3 0.1.22` 组合无原生 EcsRamRole 路径（fc3 client `_credential` 对 `__provider:custom` profile 不 wire，4 路穷尽实证；旁证 `@alicloud/credentials` default chain 通，断点在 s/fc3 wiring）。CR xyw6o3wt 裁 pivot aliyun CLI 直调 FC3.0（好品味：custom-container=镜像 URI 引用→零代码包暂存→OSS 权限面整块消除）。
> 2. **aliyun CLI fc-open**（ROA `--version 2023-03-30 --endpoint 5884645900446711.cn-hangzhou.fc.aliyuncs.com --mode EcsRamRole`）→ GetFunction ✅ 实跑证（四坐标全通：EcsRamRole 鉴权链 / 端点 / 版本 2023-03-30 / fc_route_get 三态首发分流；DATABASE_URL 值长=116 真值对账）。BUT CreateFunction POST 跑炸：fc-open `--body` 原样透传不加工任何前缀（`@file` curl 语法 / `file://` / `--body -` stdin 三枚实证均不展开，CLI parse 期拒读）→ 无法经文件传 body（inline `$(<file)` 让 DATABASE_URL 进 argv 破承重安全设计，CR/TL 驳回；标尺=最小暴露非「绝对不可得」）。
> 3. **→ node SDK helper（b3'）**（CR wtrwqdzj 裁 + TL akn8uhs6 认 + CR nnjyxwri 收敛双裁合一）：03 bash 编排（fc_route_get 三态 / trap 清理 / _tmpf 登记 / 日志报账 / 幂等主循环）全 🟢 审过**零改**，只换 fc_api 单闸口内脏（当初收口设计兑现红利）。helper 契约：`node fc_api.js <METHOD> <PATH> [BODYFILE]` typed 方法分派（`@alicloud/fc20230330@4.7.9` getFunction/createFunction/updateFunction/createTrigger，`new m.XRequest({body})` wrapper），body 经 `fs.readFile(BODYFILE)` 程序传 never argv/log；凭证 `new Credential({type:'ecs_ram_role'})`（`@alicloud/credentials@2.4.5` default export=Credential 类 getCredential 单数，纯 EcsRamRole STS 不回退静态 AK = 铁律①）；错误硬过滤只出 ErrorCode/Message/RequestId（SDK 错误对象有时回显请求体，过滤=门禁⑥ native 满足，不 `JSON.stringify(e)`）。CR🟢 95us6nem 重审四把尺 + 加尺 SDK 形状沙箱实证（钉版安装非文档信仰）+ 封签第九验字节一致。
>
> **真跑实证（2026-07-22 23:34 nr4uzthr）**：IMAGE_TAG=35f9252 ./03-fc-deploy.sh 端到端 **CreateFunction ✅ green**——函数 my-coffee-proxy 已建（runtime=custom-container / image=`…my-coffee-fc:35f9252` digest `96bf5d67…` / state=Pending 待 04 image-pull+冷启 / memorySize512·timeout60·instanceConcurrency10 审定值 / vpcConfig set / environmentVariables keys=[DATABASE_URL,FRONTEND_DIST,NODE_ENV,PORT,SHUTDOWN_TIMEOUT_MS] / DATABASE_URL 值长=116 真值，值未印）；GetFunction→FunctionNotFound→fc_route_get return 1→CreateFunction POST 分流正确，SDK helper 机制生产资源端到端实证通过。**settle 双半满足**（CR🟢 95us6nem + 真跑 CreateFunction green）。
>
> **【2026-07-23 04 实跑 uypx5j8x】**：04 healthcheck 跑炸 container start ❌ CAExited EPERM——image-pull ✅（acrInstanceId 仲裁者 PASSED，FC 从 ACR VPC 拉镜像 `:35f9252` digest `96bf5d67…` 成功）+ DATABASE_URL ✅ consumed（值长 116 注入生效），但容器冷启 `npx prisma migrate deploy` 运行时下载 schema engine 加载失败（详见 §七 migrate drift 注）。04 blocker = Prisma schema engine runtime download，非镜像/鉴权/网络。修向见 §七 migrate drift（migrate 移出冷启 → 独立 ECS 步骤）。
>
> **不变项**：4 action 集（GetFunction / CreateFunction|UpdateFunction / CreateTrigger）⊆ S2 六写名单；Dockerfile.fc 封签 fcd43385…e8e 零动（第九验字节一致）；s.yaml 头注转「声明参考非执行入口」（flow-seq 修保留）；幂等 404 分流（FunctionNotFound=预期首发→Create，存在→Update）；`acrInstanceId=cri-16ux7uiujvf8lfeg` 钉死（ACR 企业版+-vpc 镜像 host，不钉 FC 拉镜像端点解析错必挂；GetFunction 响应不回显该 input-only 字段，04 须验 image-pull 不挂端点解析）；memorySize512/timeout60/instanceConcurrency10（审定值三源一致：s.yaml↔03↔fc-server.js）；EcsRamRole 不回退静态 AK。
>
> **CreateTrigger AccessDenied（RAM 缺口，非机制问题）**：真跑首跑 CreateTrigger ❌ AccessDenied（403 / `caller is not authorized to perform 'fc:CreateTrigger' on resource 'acs:fc:cn-hangzhou:5884645900446711:functions/my-coffee-proxy/triggers/http'` / RequestId `1-6a60e291-15ccc054-37a1225fda73`）= CR 预判的 ARN 子路径残险兑现（DEMODeploy 现挂 `functions/my-coffee-proxy` 作用域，trigger 子路径 `functions/my-coffee-proxy/triggers/*` 未覆盖→403）。**非脚本 bug**（helper 错误形状归一化 blob→fc_die 透出 RequestId，surface 不死暗处，跑炸即 surface 纪律执行）。球 @aidbs-demo 控制台补 `fc:CreateTrigger` on `acs:fc:cn-hangzhou:5884645900446711:functions/my-coffee-proxy/triggers/*`（子路径收窄非 `functions/*` 全局），补后 Deploy 自重跑 03（幂等：GetFunction→exists→UpdateFunction PUT 同镜像+CreateTrigger 命中→success）→ 04。函数已建无 HTTP entry（trigger 待 ARN 补）；回滚=IMAGE_TAG=<旧digest> 重跑 03 UpdateFunction 换镜像（digest 固定可复现）。
>
> **【2026-07-23 supersede】CreateTrigger ✅ green**：@aidbs-demo 补授 `fc:CreateTrigger` on `acs:fc:cn-hangzhou:5884645900446711:functions/my-coffee-proxy/triggers/*`（子路径收窄），首跑仍 AccessDenied（RequestId `1-6a616b5f`，RAM 策略传播延迟非 scope 未对）→ +5min retry → **green**（假设(a)兑现，scope 本就对，非 (b) resource-group `rg-acfnycysnzxgx5y`）。urlInternet=`https://my-coffee-proxy-dpuvjfhfmv.cn-hangzhou.fcapp.run`。03 机制闭环（CreateFunction ✅ + CreateTrigger ✅ + image-pull ✅ + DATABASE_URL ✅ consumed）。
>
> **04 拉取鉴权 deferred**：FC 函数侧服务角色需 `cr:PullRepository` 该 repo（非 DEMODeploy ECS 侧角色，FC 侧另一授权面），04 拉不动再补，不进本轮 RAM。撞墙时频道报名（per CR 3mrsti4s 新审计纪律「往后新增 RAM action 先频道报名再添」）再 @aidbs-demo 配 FC 侧服务角色。
>
> **教训（CR-提议团队账，CR okkj5h8x 认账，待 team-confirmed 升 team-conventions）**：「验过≠可迁移——每个 CLI flag 语法必须在实际被调的那个 CLI 上验」（GET 探针不能证 POST body 展开，相邻路径证明力为零）；「文档与实证冲突时实证为权威：Theory loses, every time」。

- FC 换镜像/代码可直接 `s deploy` 覆盖（UpdateFunction PUT，免本地重建函数）。
- 回滚：`IMAGE_TAG=<旧tag/digest> ./03-fc-deploy.sh` 重跑滚回旧镜像。镜像可固定 digest。
- 迁移（migrate deploy）：本期方案为 FC 实例冷启动时容器 CMD 跑 `prisma migrate deploy`（幂等，Prisma migrations 表保证不重复应用）。**并发安全**：本项目 Prisma（prisma@5.22.0，schema-engine 二进制内置 `SELECT pg_advisory_lock(72707369)`）在 PG 上以 advisory lock 串行化并发 migration 应用，故多实例同时冷启动不会并发改 schema（非 correctness 竞态）；余 concern 是 lock-wait 延迟（突发冷启动排队），本期 `instanceConcurrency=10` + 本期低流量使概率低，规模化成问题再提取 migrate 为部署期一次性 `s local invoke` 或独立 migrate 函数（记录为后续优化，不本期实现）。

> **Drift 注（2026-07-23 实跑 04 后补，PM plan-sync per CR aohix7ut 实证纠正 + TL ebwcq4mj 裁 + CR 确认设计方向）**：本段原设「migrate 在 FC 冷启跑、规模化成问题再提取为独立步骤（后续优化）」被**运行时约束 pull forward**（非规模化触发）——
>
> **【2026-07-23 supersede（CR ga7zzjob 改裁）】**：CR 6jd4iuat「不 amend」以「模型大体正确」为条件；**02b fail（jzqfse7d）证模型已死**（read-only ldd+直 exec+node dlopen 三实证锁死：两 engine 皆 openssl-1.1.x musl 变体，alpine-3 缺 libssl 1.1，FC/ECS 同因同炸）⟹ 改裁须 amend。下列 ① drift 触发因根因句 + ② 实证纠正 + 修面 Step 梯按 CR ga7zzjob 措辞输入/终裁更新；设计弧（migrate 移出冷启→独立 ECS，FC 只 node fc-server.js 无状态）不动（CR 终裁未推翻设计方向，只推翻根因模型 + Step 梯，判别器② 收窄推翻 + Step1 预测证伪，梯子整体回归 aohix7utm Step2 菜单）。先前不 amend 裁推翻记账。
>
> **drift 触发因（CR ga7zzjob 统一根因，三实证锁死）**：04 真跑（uypx5j8x）image-pull ✅ + DATABASE_URL ✅ consumed，但 container start ❌ CAExited EPERM / 02b migrate ❌ exit 1。**根因 = build 期探测失输**（CR ga7zzjob 措辞输入逐字）：node:20-alpine 构建段缺 openssl CLI→postinstall 探测默认 openssl-1.1.x musl 变体→alpine-3 runtime 缺 libssl 1.1，**FC/ECS 同因同炸**。非 FC 沙箱扰动，非运行时下载选错——02b 无 Downloading 行=用已焙品，已焙 binary（schema-engine-linux-musl 18.7MB + libquery_engine-linux-musl.so.node 16MB）皆 openssl-1.1.x musl 变体（ldd 钉死需 libssl.so.1.1），alpine-3 runtime 只有 libssl.so.3 → 皆 load 不起。**非规模化触发**（原 L118 anticipated 的后续优化被运行时约束提前）。
>
> **实证纠正（CR aohix7ut git show 核 Dockerfile.fc → 02b fail jzqfse7d 三实证 disproof → CR ga7zzjob 统一根因 + mikw8ac8 承重句精度更新）**：两 engine **皆本已焙进镜像**（build 段 `npx prisma generate` + runtime 段 COPY node_modules；ls 实证 schema-engine-linux-musl 18.7MB executable + libquery_engine-linux-musl.so.node 16MB）——**预焙从未缺**。**消灭的仍是 migrate 及其唯一依赖 schema engine 的运行时下载**（migrate 移出冷启→独立 ECS，FC 无状态，设计弧不动——CR 终裁未推翻设计方向；libssl 缺口本就要咬任何 alpine 基镜的 prisma 使用，(c) 修 variant 是另一刀，非设计弧推翻）。**新实证（02b fail disproof）= 两 engine 虽已焙但皆错变体**（openssl-1.1.x musl，build 期 postinstall 探测失输——02b 无 Downloading 行证用已焙品，已焙品自身即依赖 libssl 1.1）；移出 migrate 解 schema engine 冷启下载面，但 query engine（FC serving 必需）同款 libssl 1.1 缺口→FC serving 亦炸，须 Step 2 重焙正确变体。**修向 = build 期显式钉 `linux-musl-openssl-3.0.x` 重焙正确变体——非补预焙，预焙从未缺，缺的是变体正确性**。原句「engine 不在镜像里」全错（两 engine 皆焙；旧句「只对 schema engine 成立」被 ls 精度超集推翻，CR ga7zzjob 收下为增量非分歧，结论=须修变体零变）。
>
> **TL 裁（ebwcq4mj）+ CR 确认设计方向**：migrate 移出 FC 冷启 → 独立 ECS 一次性步骤，FC 只 `node fc_server.js`（无状态服务）。好品味非补丁——消除特殊情况本身（冷启 migrate 是特殊情况，三个失效模式互相缠绕），C4「并发冷启 migrate 不死锁」验收项**整类消灭**（无并发冷启 migrate 场景即无死锁面）。换入 C4 验收：migrate fail-first + applied 确认 + fc_user DDL 权限界 + additive-only 不变式（至 GA，新 schema 兼容旧码=回滚窗）。
>
> **修面 Step 梯（CR aohix7utm 原裁两段 → 02b fail jzqfse7d 证伪 → CR ga7zzjob 终裁 (c)-first）**：
>
> **Step 1（零 re-bake）已跑炸**= 两点全炸：① ECS migrate 通路 FAIL（schema engine load 不起，disprove「ECS podman 用已焙 musl 零下载→works」——零下载对半：零下载对、works 错，已焙 binary 有 libssl 1.1 未满足依赖）② FC query engine cold start FAIL（node require dlopen 同型 libssl 1.1 fail，disprove「预期绿」）= **Step 2 触发**（正是 aohix7utm 裁「query engine 也撞 libssl」条件）。**判别器② 签名 fired 但因≠预设**（CR ga7zzjob 认账推翻）：.node 加载失败签名 fired，**但根因=missing libssl 1.1（依赖缺口）非 dlopen/mmap 级沙箱限制**——前裁「修向基镜/静态引擎**非** openssl-compat」（预设=沙箱限制）不 fit 本因，openssl 相关修向合法，收窄推翻；aohix7utm Step2 菜单本列过 apk add openssl/binaryTargets 两向，梯子整体回归。
>
> **Step 2 修向（CR ga7zzjob 终裁：(c) 显式钉变体先行，(a) glibc 备梯）**：**主修 (c)**（CR ga7zzjob 2 旋钮 → CR 9qtkhcse 4 消费方，Dev e13zdrmu 源码级证伪 2 旋钮的**覆盖范围**，**增量非翻案**——方向「绕过探测组件」反被坐实）= **4 个宣告式钉，一个都不能少**（4 个探测消费方各读各的 env，无法合并，是最小完整集）：
>
> ① Dockerfile.fc **build 段** `ENV PRISMA_CLI_BINARY_TARGETS=linux-musl-openssl-3.0.x`（npm ci 前置→CLI/schema engine 下对变体，钉下载面）；
> ② schema.prisma generator `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]`（query engine generate 对变体；**`native` 必留=Dev 机/mac 本地 generate 不破坏，Never break userspace 铁律**；prisma 5.22.0 钉死，linux-musl-openssl-3.0.x 自 4.x supported binaryTarget，文件名 `schema-engine-linux-musl-openssl-3.0.x` / `libquery_engine-linux-musl-openssl-3.0.x.so.node` 钉死，build log 下载名对账红灯判据）；
> ③ Dockerfile.fc **runtime 段** `ENV PRISMA_CLI_BINARY_TARGETS=linux-musl-openssl-3.0.x` **重申**（Dev 缺口①：build ENV 不继承至 runtime 段，02b migrate 跑在 runtime 段镜像→schema engine 解析经 `binariesExist()` 读 env 找已焙 openssl-3 品零回退探测；不重申则 `@prisma/get-platform` 探测找 `schema-engine-linux-musl` 缺席→按需重下 1.1.x 变体再炸或假绿掩盖）；
> ④ Dockerfile.fc **runtime 段** `ENV PRISMA_QUERY_ENGINE_LIBRARY=<.so.node 路径或 binaryTarget 名>`（Dev 缺口②，**04 生死线 non-negotiable**：`@prisma/client` loader `library.js` env 钉优先于运行时探测；不钉则 FC 无 openssl CLI→探测落 `linux-musl`（1.1.x 味）→加载 `native` 焙的坏 `.so.node`→04 必炸。loader 对路径做 `existsSync`，**路径错=静默回退探测=照炸哑雷**——优先用 binaryTarget 名 `linux-musl-openssl-3.0.x`（layout 无关，不怕 monorepo hoist 到 /app/node_modules 或 packages/backend/node_modules），名不行再退全路径；bake 后先 `ls` 钉死真实落点再定 env 值，别让 ④ 撞哑雷）。**为何显式钉非修探测（apk add openssl 补探测输入）**：这次咬我们的就是探测组件——绕过不可靠组件不修好再信它，一个机制族（显式声明）不两个（声明+探测）。**(a) glibc 基镜（node:20-slim debian）= 备梯非弃**（CR 9qtkhcse + Dev e13zdrmu 修正理解）：实证缺陷=探测失输非 musl 固有，musl×openssl「持续风险源」是理论威胁；ldd 满足的 musl-openssl-3 品若 FC 仍 DLOADER FAIL=musl 固有证据首次成立，届时 glibc 的大 diff（基镜/体积/冷启拉取/entrypoint 全层重验）才挣得它的钱。**修正（关键）**：(a) 非纯换基镜——Dev glibc 沙箱同样焙了 `rhel-openssl-1.1.x` engine（探测默认在 glibc 上照样触发），故 (a)=换基镜**+装 openssl CLI**（探测阶段需 CLI 存在才能选对变体），否则同炸。这反强化 (c)：(c) 全程不依赖探测组件，(a) 还得信探测修好——备梯位照认，理解更新。**(b) 拒**（alpine 3.21+ 已撤 libssl1.1 包+双 libssl 并存=症状补丁打地鼠），**(d) 拒**（glibc 机跑 migrate 仅修 migrate，FC serving 仍炸，单独不够，deploy/TL 认同拒）。
>
> **预宣验证梯（证据先于 FC，不再赌）**：新 bake 后、03 前，Deploy read-only **4 探针**（CR 9qtkhcse 收 Dev ④，前 3 廉价/诊断/互补全留）：① `ldd .prisma/client/libquery_engine-linux-musl-openssl-3.0.x.so.node`=libssl.so.3/libcrypto.so.3 零 not found（廉价诊断，链接面）② `schema-engine-linux-musl-openssl-3.0.x --version` 直 exec 出版本（migrate 面）③ 02b（新 tag）migrate 绿（ECS 路证；附赠「无 Downloading Prisma 行」=① runtime 钉坐实，belt-and-suspenders）④ 镜像内 `PrismaClient.$connect` 探针（alpine runtime + 无 openssl CLI=FC 环境复刻）→ `QE OK`=运行时选择面先绿，03/04 只剩 FC 平台自身变量——**④ 是 04 生死面的决定证**（对 query engine 它包含①；判别器②「musl-inherent 首证」升梯框定不变）。→ 4 步全过=机制预期再跑 03+04。若 4 步全绿而 FC 仍 DLOADER FAIL→真沙箱 dlopen 限制证据首成（判别器② 原假设复活，升梯 (a)/静态引擎换推理框架）。**封签 fcd43385 变**（预期中 Step 2 条件触发）→ re-bake 新 tag 新 digest → CR 一轮重审记新封签。
>
> **ECS migrate 六验收线（CR aohix7ut 审的尺）**：① fail-first 序（migrate 跑在 03 UpdateFunction 前，schema 先于 code，败即 abort=函数永不接期待新 schema 的码）；② DATABASE_URL 走 03 同款 `~/.aliyun-env` 同文件（deploy 现有托管面零新增）；③ 频道+日志只状态（`pending N→0 applied` 键名不印值，门禁⑥）；④ 幂等可重跑（migrate deploy 只应 pending）；⑤ additive-only 不变式至 GA（新 schema 须兼容旧码=回滚窗）；⑥ 注入经环境变量不经 argv（ps 面，`--env-file` 非 `-e 值`）。机制 deploy 自选（ECS npx 或 docker run 带 env 皆可），脚本产出报审一轮。
>
> **一致性扫（折进本次 Step 2 re-bake，一票 coherent commit）**：Dockerfile.fc CMD → `node fc-server.js` + 删 migrate 注释段（消灭 CMD × FC config 双源，宣告式限期背离退役）+ (c) 两件（PRISMA_CLI_BINARY_TARGETS ENV + schema.prisma binaryTargets）+ 02b IMAGE_TAG 守卫移 `source common.sh` 前（🟡1 死守卫修复——死守卫比没守卫糟，声称给不出的保护）+ 02b timeout 行内注释精确化（🟡2，零下载模型）+ 02b mode-bit 755。Step 2 已触发（非「Step 1 绿且无需」路径），能一趟 bake 清的不分两趟。

## 八、风险清单

| 风险 | 缓解 | 责任 |
| --- | --- | --- |
| RDS 未就绪 | 阻塞实测部署，不阻塞设计；需 @aidbs-demo 给时间线+VPC 连接串+凭证 | @aidbs-demo |
| 连接池数学对不上后端 | connection_limit 锁定 =3，两份设计交叉校验 | 部署+后端+CR |
| 并发 migrate 竞态 | 本期低流量 + instanceConcurrency 控制；必要时提取独立 migrate | 部署 |
| migrate deploy 每次冷启动跑（CR 非阻塞） | Prisma migrate deploy 用 `pg_advisory_lock`（本项目 prisma@5.22.0 schema-engine 内置 `SELECT pg_advisory_lock(72707369)`）串行化并发应用、保证不重复改 schema；规模化后 lock-wait 成冷启动延迟来源，真成问题再挪进 03-fc-deploy 脚本，本期不动 | 部署 |
| HTTP 触发器 authType=anonymous（CR 非阻塞） | 点单 API 公网裸露无鉴权限流，demo 阶段接受；上线/正式环境须加鉴权（FC 自定义授权/网关层）或限流 | 部署 |
| FC 平台 SIGTERM grace 实际值未核（CR 非阻塞） | C3 部署前必核平台文档实际 grace 值，SHUTDOWN_TIMEOUT_MS(8s) 已留 env 覆盖旋钮确保 < grace | 部署 |
| FC 冷启动 1-3s 体感 | 前端 P0 loading 已 cover（@agent-ascyygmc）；可配 FC 预留实例（后续） | 前端/部署 |
| RDS 连接打满 | 基线 connection_limit=3 + 监控；超阈值启用 RDS Proxy | 部署 |

## 九、与各角色设计的依赖关系

- **@agent-rhx6ueqf（数据层）**：Prisma provider sqlite→postgresql、connection_limit=3（与本设计对齐）、SIGTERM 钩子 $disconnect（fc-server.js 调用）、Decimal(10,2)/String 长度/migration 重生成。后端改完我才 bake 最终 fc-app 镜像。
- **@agent-gtuw85fn（CR）**：本设计 + fc-server.js graceful shutdown + 连接池数字，请先 review。
- **@agent-s3swdr9b（QA）**：test.db→test PostgreSQL、部署验收（FC 冷启动/并发一致性/连接池场景）依赖本设计的 instanceConcurrency 与连接池配置。
- **@agent-ascyygmc（前端 UE）**：Decimal→number 适配依赖后端迁移；FC 冷启动 loading 已在 P0 cover。

## 十、验收（设计通过条件）

- [ ] CR review 通过（优雅关闭顺序、连接池数学、复杂度预算）
- [ ] TL 验收：跨角色数字一致（connection_limit=3 × instanceConcurrency=10 的对应关系与后端设计对得上）
- [ ] RDS PostgreSQL 就绪（VPC 连接串 + 凭证 + max_connections 真实值）
- [ ] 后端 Prisma 迁移落地（fc-app 最终镜像 bake 前置）
通过后 PM 拆实现任务，我认领后执行 01→04。
