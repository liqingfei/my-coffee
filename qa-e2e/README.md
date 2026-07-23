# QA E2E（my-coffee 前端回归）

Playwright headless 驱动 vite:5173（/api 代理到 backend:3001）的真实浏览器端到端用例，覆盖 5 条关键用户路径。

## 用例覆盖

- E2E-2 菜单分类筛选
- E2E-5 异常路径（前端校验 + 后端 404/400 兜底）
- E2E-1 完整下单→配送（含 E2E-3 订单详情、E2E-4 配送追踪）
- #3 订单列表页（Scene 4 QA 验收，工作项 #3）：
  - /orders 直访渲染 + 导航栏"订单"入口 + 深链刷新
  - 下单后列表置顶 + 行字段（状态=待确认、金额 ¥xx.xx）—— P0，对应用户原始 bug"下单后看不到订单页"
  - 创建配送入口：仅 `delivery==null` 显示、confirm 后创建、创建后按钮消失
  - 查看详情跳转 `/orders/:id`
  - 状态筛选本地过滤正确性 + 空态（按无订单状态筛选，不 wipe 共享 DB）

## 前置

> ⚠️ `schema.prisma` provider=`postgresql`，后端必须连 PostgreSQL。下方原 `file:./dev.db`
> 为过期 SQLite 残留、**不可用**（provider 不匹配）。请用真实 PG DATABASE_URL。

1. 后端：`cd packages/backend && DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/mycoffee_dev" PORT=3001 npx prisma migrate deploy && DATABASE_URL=... PORT=3001 npx tsx src/index.ts`（先 migrate deploy 建表，再 seed）
2. 前端：`cd packages/frontend && npx vite --port 5173 --host 127.0.0.1`
3. chromium：`npx playwright install chromium`（缺 X 库时按系统补装，如 RHEL 系 `dnf install atk at-spi2-atk at-spi2-core libxcb alsa-lib mesa-libgbm libX11 libXext cairo pango libXcomposite libXdamage libXfixes libXrandr`）

## 运行

```bash
# 默认用 Playwright 自带 chromium
node qa-e2e/e2e.mjs

# 或指定 chromium 路径 / 自定义前端地址
CHROME_PATH=/path/to/chrome E2E_BASE_URL=http://127.0.0.1:5173 node qa-e2e/e2e.mjs
```

退出码 0=全绿，非 0=有用例失败。
