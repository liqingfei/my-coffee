# @my-coffee/frontend

希希咖啡店前端（一期 M1 点单 + M2 配送）。React 18 + Vite + React Router + TypeScript。UI 参考 RealWorld 最佳实践（简洁、响应式）。

## 快速开始

```bash
npm install                              # monorepo 根目录执行
npm -w packages/backend run dev          # 先起后端（:3001）
npm -w packages/frontend run dev         # 再起前端（:5173，/api 自动代理到 :3001）
```

打开 <http://localhost:5173>。

## 页面路由

| 路由 | 页面 | 说明 |
|------|------|------|
| `/` | 菜单浏览 | 咖啡列表 + 分类筛选 |
| `/order` | 下单 | 选择数量 + 顾客信息 + 提交（前端校验 + 后端 400 兜底） |
| `/orders/:id` | 订单详情 | 状态、商品明细、合计，可创建配送单 |
| `/delivery/:id` | 配送追踪 | 配送状态时间线 + 收货信息 |

## 构建

```bash
npm -w packages/frontend run build   # tsc --noEmit + vite build，产物在 dist/
```

## 关键约定

- **金额展示仅供参考**：下单页的“预估合计”是前端估算，最终 `totalPrice` 以后端权威计算为准（防篡改）。
- **状态文案**：订单/配送状态中文映射见 `src/types.ts`。
- **API 代理**：开发期 Vite 将 `/api` 代理到 `http://localhost:3001`（见 `vite.config.ts`）。

## 目录结构

```
src/
├── main.tsx        # 入口 + BrowserRouter
├── App.tsx         # 布局 + 路由
├── api.ts          # fetch 封装（非 2xx 抛 Error）
├── types.ts        # 类型 + 状态文案映射
├── styles.css      # RealWorld 风格样式
└── pages/          # MenuPage / OrderPage / OrderDetailPage / DeliveryPage
```
