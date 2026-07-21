# A2 数据层设计 — Prisma SQLite → RDS PostgreSQL（方案二 · PG 修订 v2）

> 作者：@Dev-claude（@agent-rhx6ueqf）｜对应 CodeMatrix #13 / GitHub issue #2
> 状态：**PG 修订 v2**（2026-07-21 人类裁定用 PostgreSQL——RDS 实例实测 TCP 5432 开 / 3306 关，引擎实锤 PG），待 @agent-gtuw85fn CR 复审（六条处方逐项）+ @agent-8f7cny5f TL 确认。A5/A6 验收的**引擎无关不变式全数继承**，本版仅重审 provider 相关口径。
> 范围：仅数据/入口层（schema、Prisma 客户端、序列化边界、migration、测试库）。
> 不动业务路由/状态机/校验；前端零改动。所有结论均**实读 packages/backend/src 核对**，非二手转述。

本文是 C1（后端改造）的施工图：写明"改什么、为什么、改在哪一行"，并把跨角色数字与 A1 锁死对齐。

> **PG 修订 v2 变更摘要**（相对 MySQL 版 `07a2136`）：
> - 核心两处：`provider = "postgresql"`（§1.1）+ URL scheme `mysql://`→`postgresql://`（端口 3306→5432）
> - §1.3 措辞改 PG 事实：PG `String` 默认 `text`、无 varchar(191) 截断陷阱；`@db.VarChar(n)`/`@db.Text` 从"防截断必需"降级为"显式语义选择"，**注解全保留、model 块一行不动**
> - §3 钉死：PG 下 Prisma query 参数仍名 `connection_limit`，串尾写法一字不变
> - §4 重生成目标换 PG 空库 `mycoffee_dev`（admin 账号自建 dev+test 两库），流程与零手写 SQL 原则原样
> - §7 测试库 URL scheme 同步；§8/§9 口径同步
> - **引擎无关不变式一条未动**：5 落点 Number 转换（含嵌套 `order.delivery?.fee`）、`connection_limit=3` 串尾单源、优雅关闭顺序、`createApp()` 不改、typeof 契约断言矩阵、线协议 JSON number

---

## 0. 设计目标与硬约束

1. **provider sqlite → postgresql**，对接 RDS PostgreSQL（VPC 内网）。
2. **金额用 Decimal(10,2)** 落库与计算，杜绝浮点误差；但**线协议保持 JSON number**，前端零改动（满足 CR 向后兼容门禁——一期 8 commits 在 main，契约变即 bug）。
3. **connection_limit = 3** 锁死，与 A1 DESIGN §5 一致（s.yaml 侧已按 §3 单源化移除 `CONNECTION_LIMIT`；TL 验收项：两边对不上=设计不通过）。
4. **migration 历史整体重生成**，不手写 SQL、不留 down 脚本（Prisma 无原生 down migration，详见 §4）。
5. 入口导出形式**已是 `createApp()` 工厂**，C1 不改入口（已实读 `src/app.ts` 确认，详见 §6）。

---

## 1. Schema 变更（`prisma/schema.prisma`）

### 1.1 provider 切换
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```
`DATABASE_URL` 形如 `postgresql://USER:PASS@RDS_HOST:5432/DB?connection_limit=3`（连接池见 §3）。

### 1.2 金额字段 Float → Decimal(10,2)
| 模型.字段 | 现状 | 改为 | 理由 |
| --- | --- | --- | --- |
| `MenuItem.price` | `Float` | `Decimal @db.Decimal(10,2)` | 单价，金额 |
| `Order.totalPrice` | `Float` | `Decimal @db.Decimal(10,2)` | 合计，金额 |
| `Delivery.fee` | `Float @default(5.0)` | `Decimal @db.Decimal(10,2) @default(5.0)` | 配送费，金额 |

`@db.Decimal(10,2)`：最大 99999999.99，咖啡金额绰绰有余；2 位小数对齐展示精度。

> 关键后果：Prisma 读 `Decimal` 列返回 **Prisma.Decimal 实例**，JSON 序列化会变成**字符串**。若不处理，前端 `price.toFixed(2)` 对字符串调用 → 运行期 TypeError / NaN。**唯一解法 = 在响应边界转 Number**（§2）。

### 1.3 String 显式长度（显式长度约束；长文本用 @db.Text）
| 模型.字段 | 改为 | 理由 |
| --- | --- | --- |
| `MenuItem.name` | `String @db.VarChar(100)` | 商品名 |
| `MenuItem.description` | `String @db.VarChar(500)` | 描述 |
| `MenuItem.category` | `String @db.VarChar(50)` | 分类枚举值 |
| `MenuItem.imageUrl` | `String? @db.VarChar(500)` | URL |
| `Order.items` | `String @db.Text` | **JSON 字符串 blob**，无界文本的显式语义选择（PG `String` 默认即 `text`、无截断；显式 `@db.Text` = 显式优于隐式，与 MySQL 版口径一致） |
| `Order.status` | `String @db.VarChar(20)` | 状态机取值 |
| `Order.customerName` | `String @db.VarChar(100)` | |
| `Order.customerPhone` | `String @db.VarChar(32)` | |
| `Order.customerAddress` | `String @db.VarChar(255)` | |
| `Delivery.status` | `String @db.VarChar(20)` | |

> 仍**不引入 enum**：状态用 String + 应用层 `lib/status.ts` 校验，保持 provider 可移植（CR 复杂度预算：不为"更类型化"加迁移负担）。
> **PG 事实**：PostgreSQL 下 `String` 无注解默认映射 `text`，**不存在** MySQL `varchar(191)` 默认截断陷阱——故显式 `@db.VarChar(n)` 从"防截断必需"降级为"schema 自描述的显式长度约束"（保留注解：显式优于隐式、跨引擎可读；**model 块注解一行不重构**）。`@db.Decimal(10,2)` / `@db.Text` 在 PG 均为合法原生类型，全部保留。

### 1.4 其余不变
`@id @default(autoincrement())`、`@unique`、`@relation`、`DateTime @default(now())` 均 postgresql 兼容，照旧。

---

## 2. Decimal → Number 转换：在**响应边界**一处转，线协议不变

### 原则
- 落库/累加用 Decimal 保精度；**只在"从 Prisma 读出 → 进入响应对象"的边界**用 `Number()` 转出。
- 转一次，下游（routes `res.json`、前端）全看到 JSON number，与现状 sqlite 行为**逐字节等价** → 前端零改动、CR 兼容门禁通过。
- routes 层已实读确认：`orders.ts`/`menu.ts`/`deliveries.ts` 均 `res.json(serviceResult)` **直通**，无二次序列化。故"响应边界"= service 层返回值，无需动 routes。

### 写路径为何不用改
`createOrder` 里 `round2(...)` 产 JS number，`JSON.stringify(orderItems)` 把 number 写进 JSON 串；`prisma.order.create({ data:{ totalPrice: <number> } })` Prisma 自动把 number 转 Decimal 落库。**写方向 Prisma 已处理**，无需动。

### 精确落点（实读行号，C1 按此改）

**`src/services/order.service.ts`**
- L73 读出后立刻转：`const menuItem = await prisma.menuItem.findUnique(...)` 之后加
  `const price = Number(menuItem.price);`
- L81：`const subtotal = round2(price * quantity);`（用本地 `price: number`，避免 Decimal×number 得 Decimal 再喂 round2）
- L87：`price,`（快照即上面的 `price: number`）
- `serializeOrder()` L37-42：`Order.totalPrice` 现为 Decimal，展开 `...order` 会带字符串；且 `order.delivery` 是嵌套 Delivery 行，其 `fee` 同为 Decimal，`?? null` 直通会把 fee 以字符串送出（前端 `fee.toFixed(2)` 对字符串调用 → TypeError——这是 GET /api/orders/:id 带配送单的真实路径，CR 🔴 指出）。改为显式覆盖，**嵌套 delivery 复用 delivery.service.ts 抽出的 `serializeDelivery`**（同一转换器、两条出口，不复制第二份转换逻辑）：
  `return { ...order, totalPrice: Number(order.totalPrice), items, delivery: order.delivery ? serializeDelivery(order.delivery) : null };`
  > `items` 来自 `JSON.parse(order.items)`，是**落库时已 stringified 的 number**（写路径已是 number），parse 回来即 number，**无需再转**——这点要写进代码注释，否则后人会重复加 Number。
  > 嵌套 `delivery.fee` 是**第 5 个** Decimal→Number 落点（经 serializeOrder 出口）。`serializeDelivery` 因此服务两条路径：delivery.service.ts 三个独立端点 + 此处经 serializeOrder 的嵌套路径。实现上把 `serializeDelivery` 从 delivery.service.ts **export**，order.service.ts **import** 复用——单一实现，两处引用。
  > **C1 类型注意（CR 🟢 评审处方，必须照做）**：`serializeOrder` 现签名 `order: Order & { delivery?: unknown }`，`order.delivery` 是 `unknown`，直接喂给按 `Delivery` 签名的 `serializeDelivery` 过不了 tsc。二选一：把 `serializeDelivery` 参数签成结构化类型（如 `d: { fee: Prisma.Decimal | number } & Record<string, unknown>`），或在调用点显式 cast。**禁止**把 `delivery?: unknown` 改成 `any` 糊过去。

**`src/services/menu.service.ts`**
- `listAvailableMenu` 现状**直返 Prisma 行**（`MenuItem[]`），无序列化层。新增映射：
  `return rows.map((m) => ({ ...m, price: Number(m.price) }));`
  （返回类型仍兼容 `MenuItem` 形状，只是 price 变 number；如需类型精确可定义 `MenuItemResponse`。）

**`src/services/delivery.service.ts`**
- `createDelivery`/`getDelivery`/`transitionDeliveryStatus` 三处**直返**带 `fee` 的 Delivery。抽一个 **export** 的 `serializeDelivery(d)`：`{ ...d, fee: Number(d.fee) }`，三处 return 统一走它（与 order 的 `serializeOrder` 对称，单一职责：出口转金额）。**并供 order.service.ts 的 serializeOrder import 复用**（嵌套 delivery 路径，见上）——一个转换器覆盖全部 4 个含 `fee` 的出口，无第二份逻辑。

### 为什么是"读边界转"而不是"全局 toJSON 拦截"
全局拦截 Prisma.Decimal.prototype.toJSON 是隐式魔法、跨文件难追、CR 复杂度预算会打回。显式 `Number()` 落在 4 个函数的 5 个点位（createOrder 单价、serializeOrder 合计、serializeOrder 嵌套 delivery.fee、listAvailableMenu 单价、serializeDelivery 配送费），各一行，可读、可测、零魔法。**如非必要，勿增实体。**

### 精度安全
咖啡单价 ≤ 几百、2 位小数，`Number(Decimal)` 在 `Number.MAX_SAFE_INTEGER`(2^53) 内且 2 位小数可精确表示，无损。合计同理。无需 BigDecimal 库。

---

## 3. 连接池配置（connection_limit = 3 锁死）

### 决策：用 DATABASE_URL 查询串注入，不读独立 env
现状 `src/lib/prisma.ts`：`export const prisma = new PrismaClient();`（**无参，未读任何 env**——已实读确认）。

C1 改法（**采用 deploy 提的方案 a，并收紧**）：
```ts
export const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});
```
并在 `DATABASE_URL` 串尾带 `?connection_limit=3`。**PG 下同参数名**：Prisma 的 PostgreSQL connector 同样识别 `connection_limit` query 参数（与 MySQL connector 同名），串尾写法一字不变——单一事实源决策引擎无关。

**为什么不另读 `CONNECTION_LIMIT` env（否决 deploy 方案 b）**：s.yaml 同时设了 `DATABASE_URL` 和 `CONNECTION_LIMIT="3"`。若代码再读 `CONNECTION_LIMIT` 拼进客户端，就出现**两个 env 控制同一事实**——一旦漂移（一个改一个没改），连接池与设计不符却静默。单一事实源 = 把 3 钉在 `DATABASE_URL` 串里（凭证所在的那条 env），删掉/忽略 s.yaml 的 `CONNECTION_LIMIT`（或仅保留作人类注释，代码不读）。**一个事实，一处定义。**

> 给 deploy 的回路：A1 s.yaml 的 `CONNECTION_LIMIT` 与代码解耦后，请确认 `DATABASE_URL`（即 `RDS_DATABASE_URL`）已含 `?connection_limit=3`；若由你侧拼接，把该参数并入 RDS_DATABASE_URL，`CONNECTION_LIMIT` 变量可移除或标注"仅供参考，代码不读"。这条 A1↔A2 闭环在 C1/C3 落地前对齐。

### 交叉校验（TL 验收项）
- 后端 connection_limit = **3** ≡ A1 DESIGN §5 表 ≡ s.yaml 语义。任一处≠3 = 设计不通过。
- pool(3) < instanceConcurrency(10)：有意排队，最坏排队深度 7（A1 §5 已写明延迟账，本设计不重复，仅引用）。

---

## 4. Migration 策略：整体重生成，不手写 SQL、不留 down

### 为什么必须重生成（不能改现有 init）
现有历史：`prisma/migrations/20260721015603_init/` + `migration_lock.toml`（lock = **sqlite**）。
- 该 init 的 SQL 是 **SQLite DDL**；`prisma migrate deploy` 在 PostgreSQL 上跑 SQLite DDL 必失败。
- `migration_lock.toml` 的 provider 也必须 = postgresql，否则 Prisma 直接报错。
- 结论：provider 切换后，**旧历史整段作废**，必须用 postgresql provider 重新生成一条全新历史。

### 步骤（C1 执行，设计阶段不跑）
1. 改 `schema.prisma`（§1）。
2. 删 `prisma/migrations/` 全目录 + `migration_lock.toml`。
3. 指向**空 PG 库 `mycoffee_dev`**，`prisma migrate dev --name init` → 生成新的 `YYYYMMDD_init/`（PG DDL）+ 新 lock（provider=postgresql）。
4. 应用启动 / 容器 CMD 用 `prisma migrate deploy`（**只 apply 已提交历史，不 dev**）——A1 Dockerfile.fc / s.yaml CMD 已是 `npx prisma migrate deploy && node fc-server.js`，一致。
5. 本地 dev / C1 执行：`DATABASE_URL=postgresql://...mycoffee_dev?connection_limit=3` 后 `migrate dev`。
6. **provisioning（admin 自建，不等外部）**：`~/.aliyun-env` 的 admin 账号有 CREATE DATABASE 权，`mycoffee_dev`（空）+ `mycoffee_test` 两库由 C1/C2 侧自建——Prisma `migrate dev`/`db push` 对缺失库自动建库，一条 DDL 的事，不再向 @aidbs-demo 要库名。

### 回滚（无 down migration——这是 Prisma 的物理事实）
- **不手写 down SQL**（CR 门禁已修正：不留手写 SQL）。
- 回滚走**旧镜像 tag**（上一版仍 sqlite 镜像）或**新增一条前向 migration** 修数据。
- 一期未上线、无生产数据 → 重生成零数据迁移成本，正是最简路径。

---

## 5. 优雅关闭（引用 A1 §6，不重复实现）

入口在 A1 `fc-server.js`，顺序（CR 正确性约束）：
`SIGTERM/SIGINT → server.close() 拒新 → drain 存量(≤DRAIN_BUDGET) → prisma.$disconnect()(≤DISCONNECT_BUDGET, Promise.race 超时) → exit`，总预算 8s < FC grace。

**A2/C1 对数据层的承诺**：`prisma.$disconnect()` 必须可被超时打断（A1 已用 Promise.race 兜底）；后端代码**不**在请求路径里持有长事务/未释放连接，保证 drain 能在预算内排空。`src/index.ts`（ECS standalone 入口）当前**没有** shutdown handler（只 `$connect` + listen）——这是 FC 形态由 fc-server.js 接管的理由；standalone 本地 dev 不需要优雅关闭，保持现状，**不为本地入口加对称 handler**（复杂度预算：本地 dev 进程被 Ctrl-C 强退可接受）。

---

## 6. 后端改动清单（C1 边界）—含 createApp() 接口确认

PM/CR/TL 关心的跨角色接口，已实读确认：

| 接口点 | 现状（实读） | C1 是否改 |
| --- | --- | --- |
| `src/app.ts` 导出 | `export function createApp()` **工厂** | **否**——已是工厂，fc-server.js `require("./dist/app").createApp` 直接命中，零入口改动 |
| `src/lib/prisma.ts` | `new PrismaClient()` 无参 | **是**——加 `datasources.db.url`（§3），connection_limit 走 URL 串 |
| 金额序列化 | sqlite 下 number 直通 | **是**——§2 的 5 处 `Number()`（4 函数；含 serializeOrder 嵌套 `delivery.fee` 复用 serializeDelivery） |
| schema | sqlite/Float/无长度 | **是**——§1 |
| migrations | sqlite 历史 | **是**——§4 重生成 |

> 给 PM 的明确答复（msg d1yzicig / yjfw8pp1）：**当前就是 `createApp()` 工厂，不是 `export default app` 实例**，故"调整为工厂"**不**进 C1 清单。deploy msg kctte98k 的第 1/2/3 点与我实读一致。需进 C1 清单的只有第 4 点（prisma 单例读 connection_limit），落地方式由本设计 §3 定为"URL 串方案 a"。

C1 单一边界：数据层 + Prisma 客户端 + 序列化边界 + migration。**不**碰 routes 形状、状态机、校验、前端。

---

## 7. 测试库改造（test PostgreSQL 库，对齐 QA A4 已验收矩阵）

现状：`tests/jest.globalSetup.js` 对 `file:./test.db` 跑 `prisma db push --force-reset`；`jest.setup.js` 设 `DATABASE_URL=file:./test.db`。sqlite 文件，无并发问题。

改 test PG 库（QA A4 msg 35ag5pz1 已定调，本设计给施工细节）：
1. **测试库**：同实例独立库 `mycoffee_test`（admin 自建，见 §4 步 6），与 dev/prod 隔离。`jest.setup.js` 设 `DATABASE_URL=postgresql://...mycoffee_test?connection_limit=2`（**测试连接池调低**，避免多文件/多连接打爆 test 实例）。
2. **globalSetup 跑一次** `prisma migrate reset --force`（drop+重放全部 migration+reseed）——**验证 §4 新历史能干净 apply**（C1 真实回归风险），整 run 一次。
3. **文件间隔离改 TRUNCATE+reseed**（不再每文件 reset）——对齐现状 `db push --force-reset` 的隔离级别，更快。reset 验历史、TRUNCATE 管隔离，一个概念干一件事。
4. **runInBand** 保持（jest.config 已设）——单进程串行，避免并发 reset/truncate 互踩；PG 下同样重要。
5. seed：复用 `prisma/seed.ts` 逻辑（注意它 `deleteMany` 全表后重写菜单——TRUNCATE 路径要等价处理外键顺序：先 delivery 后 order 后 menu，与 seed.ts 现顺序一致）。

> 测试库 provisioning **不阻塞**本文评审、也不阻塞 C2：admin 账号自建 `mycoffee_test`（§4 步 6，与 dev 库同批，一条 DDL）。

---

## 8. 风险与未决

- **RDS 真实 `max_connections`**：A1 §5 取 ≥200 假设；需 @aidbs-demo 控制台确认（**C3 门禁，不挡 C1/C2**）。PG 常见默认 100，`20×3=60≤100` 余量仍够；真实值一给即核，不足或实例上限 >20 则按 A1 §5 触发 RDS Proxy。
- **`?connection_limit` 与 s.yaml `CONNECTION_LIMIT` 双源**：见 §3 回路，C1/C3 前闭合，避免静默漂移。
- **Decimal 序列化回归**：C1 必须加契约断言——`typeof price/totalPrice/fee === 'number'`，**并加嵌套 `order.delivery?.fee === 'number'`**（GET /api/orders/:id 带配送单路径，CR 🔴 指定；QA A4 第 5 转换点已列此断言 + E2E NaN 兜底，🟢 收下）。本设计 §2 是其实现依据。
- **items JSON 内金额**：写路径已是 number，读路径 parse 即 number，**不**受 Decimal 影响——但若未来有人改成"读后从 Decimal 重算 items"，会引入字符串；§2 注释需挡掉这种改法。

---

## 9. 验收对照（给 CR / TL 的逐项核对表）

- [ ] provider=postgresql；金额三字段 Decimal(10,2)；String 全显式长度、items=@db.Text（PG 均合法原生类型，model 块注解不重构）（§1）
- [ ] Decimal→Number 在 §2 四函数 5 落点读边界（含 serializeOrder 嵌套 `delivery.fee` 复用 serializeDelivery），routes 不动，线协议=JSON number，前端零改动
- [ ] connection_limit=3 经 DATABASE_URL 串注入，单事实源，与 A1 §5/s.yaml 一致（§3）
- [ ] migrations 整体重生成，无手写 SQL、无 down（§4）
- [ ] createApp() 已是工厂，C1 不改入口；prisma 单例读连接池纳入 C1（§6）
- [ ] 优雅关闭引用 A1 §6，数据层不持长事务（§5）
- [ ] test PG 库：globalSetup reset 一次 + 文件间 TRUNCATE + runInBand + 低 connection_limit（§7）
