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

- FC 换镜像/代码可直接 `s deploy` 覆盖（UpdateFunction PUT，免本地重建函数）。
- 回滚：`IMAGE_TAG=<旧tag/digest> ./03-fc-deploy.sh` 重跑滚回旧镜像。镜像可固定 digest。
- 迁移（migrate deploy）：本期方案为 FC 实例冷启动时容器 CMD 跑 `prisma migrate deploy`（幂等，Prisma migrations 表保证不重复应用）。**并发安全**：本项目 Prisma（prisma@5.22.0，schema-engine 二进制内置 `SELECT pg_advisory_lock(72707369)`）在 PG 上以 advisory lock 串行化并发 migration 应用，故多实例同时冷启动不会并发改 schema（非 correctness 竞态）；余 concern 是 lock-wait 延迟（突发冷启动排队），本期 `instanceConcurrency=10` + 本期低流量使概率低，规模化成问题再提取 migrate 为部署期一次性 `s local invoke` 或独立 migrate 函数（记录为后续优化，不本期实现）。

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
