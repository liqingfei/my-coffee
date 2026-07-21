# @my-coffee/backend

希希咖啡店后端（一期 M1 点单 + M2 配送）。Express + TypeScript + Prisma(SQLite)。

## 快速开始

```bash
cp .env.example .env          # DATABASE_URL=file:./dev.db, PORT=3001
npm install                   # monorepo 根目录执行
npm -w packages/backend run prisma:migrate   # 建库 + 应用 migration + seed 初始菜单
npm -w packages/backend run dev              # http://localhost:3001
```

服务启动会自动应用 migration（`prisma migrate dev/deploy`），无需手工执行 SQL。

## 测试

```bash
npm -w packages/backend test              # Jest + Supertest，使用独立 test.db
npm -w packages/backend run test:coverage # 覆盖率（门禁：lines ≥80%）
```

测试库 `prisma/test.db` 与开发库 `prisma/dev.db` 隔离，每个用例自带 reset/seed，互不依赖。

## API 概览

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/menu?category=` | 可用菜单（可按分类过滤） |
| POST | `/api/orders` | 创建订单，`items:[{menuItemId,quantity}]`，totalPrice 服务端重算 |
| GET | `/api/orders?status=` | 订单列表 |
| GET | `/api/orders/:id` | 订单详情（含 delivery） |
| PATCH | `/api/orders/:id/status` | 订单状态流转（受状态机约束） |
| POST | `/api/deliveries` | 创建配送单，`{orderId}`，fee 固定 5，顾客信息继承订单 |
| GET | `/api/deliveries/:id` | 配送状态查询 |
| PATCH | `/api/deliveries/:id/status` | 配送状态流转（受状态机约束） |

完整契约见 `openapi.yaml`。

## 关键设计

- **金额权威计算**：`POST /api/orders` 忽略客户端传入的价格，按 DB 中 MenuItem.price × quantity 重算（四舍五入到 2 位），防篡改。
- **状态机**：SQLite 不支持 enum，状态用 String 承载，合法流转在 `src/lib/status.ts` 集中校验，仅允许流转到下一状态，非法跳变返回 400。
  - Order: `pending → confirmed → preparing → delivering → completed`
  - Delivery: `pending → picked_up → in_transit → delivered`
- **配送继承订单**：Delivery 不冗余存储顾客地址/电话，通过 relation 继承，`POST /api/deliveries` 只需 `orderId`；同一订单重复创建返回 409（orderId 唯一）。
- **错误处理**：`AppError` 携带状态码，统一错误中间件映射（P2002→409，body 解析失败→400，其余→500）。

## 目录结构

```
src/
├── index.ts            # 服务入口
├── app.ts              # Express 组装（导出 createApp 供测试注入）
├── lib/                # prisma 单例 / 错误处理 / 状态机 / async 包装
├── routes/             # menu / orders / deliveries
└── services/           # 业务逻辑（单测主要覆盖层）
prisma/
├── schema.prisma       # MenuItem / Order / Delivery
├── migrations/         # init migration
└── seed.ts             # 初始菜单（幂等）
tests/                  # Jest + Supertest
```
