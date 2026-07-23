// fc-server.js — FC custom-container 入口（CommonJS，与后端 tsconfig module=cjs 一致）
// 单函数整体上 FC：同时托管 /api（后端 Express）与 /（前端 Vite 静态），DB = RDS PostgreSQL。
// 优雅关闭顺序（CR 正确性约束，见 DESIGN.md 第六节）：
//   SIGTERM → server.close() 拒新连接 → drain 存量(带超时) → prisma.$disconnect() → exit
//   必须先关 HTTP 再断 DB，否则 drain 中的请求会拿到已断开的 DB 连接。
// 设计阶段模板，未执行；待 DESIGN.md 评审通过 + RDS 就绪后随镜像 bake 生效。
const path = require("path");
// backend tsconfig rootDir="." + include=[src,prisma,tests] → tsc 保相对路径，输出 dist/src/...
// （非扁平 dist/app；rootDir=. 对多目录 include 是正确的，shim 须匹配实际输出结构）。
// 04 healthcheck 实证此路径（前版 ./dist/app → Cannot find module './dist/app'，2026-07-23）。
const { createApp } = require("./dist/src/app");
const { prisma } = require("./dist/src/lib/prisma");

const FRONTEND_DIST = process.env.FRONTEND_DIST || path.join(__dirname, "../../frontend-dist");
const PORT = Number(process.env.CAPort || process.env.PORT || 9000);
// SHUTDOWN_TIMEOUT_MS = 优雅关闭【总预算】，必须短于 FC 平台 SIGTERM→SIGKILL 宽限期
// （custom-container 默认约 10-15s，部署时以平台实际值为准；本设计取 8s 留余量）。
// 内部再拆成 drain 预算 + disconnect 预算，保证 总耗时 ≤ SHUTDOWN_TIMEOUT_MS < FC grace。
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS || 8000);
const DISCONNECT_BUDGET_MS = Math.min(3000, Math.floor(SHUTDOWN_TIMEOUT_MS * 0.33)); // $disconnect 独立超时（CR ②）
const DRAIN_BUDGET_MS = SHUTDOWN_TIMEOUT_MS - DISCONNECT_BUDGET_MS;                 // drain 用余下预算

const app = createApp();

// 前端静态资源托管（部署层职责）。业务路由全由 createApp()（./dist/app）装配，
// /api 未知路由由 app.ts 的 /api 作用域 404 处理；此处仅静态+SPA 回落，不重复路由（CR ④）。
const expressStatic = require("express").static;
app.use(expressStatic(FRONTEND_DIST, { index: false }));
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(FRONTEND_DIST, "index.html"));
});

async function start() {
  await prisma.$connect();
  const server = app.listen(PORT, () => {
    console.log(`[fc] listening on ${PORT}, static=${FRONTEND_DIST}`);
  });
  server.on("error", (e) => { console.error("[fc] listen error", e); process.exit(1); });

  let shuttingDown = false;
  const shutdown = async (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[fc] ${sig} received, draining (close HTTP first, then DB)…`);
    // 1) 先关 HTTP：拒新连接 + 立即断空闲 keep-alive（CR 🟡：close 只拒新，空闲连接不自带关，FC LB hold keep-alive 是常态）
    server.close();
    server.closeIdleConnections();
    // 2) drain 在途请求：server close 回调在所有连接关闭后触发；上限 DRAIN_BUDGET_MS，给 disconnect 留预算；早 resolve 清 timer（卫生）
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
      server.on("close", finish);
      const timer = setTimeout(finish, DRAIN_BUDGET_MS);
    });
    // 3) 再断 DB：$disconnect 自带 DISCONNECT_BUDGET_MS 超时兜底，防挂死（CR ②）
    try {
      await Promise.race([
        prisma.$disconnect(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("disconnect timeout")), DISCONNECT_BUDGET_MS)),
      ]);
    } catch (e) {
      console.error("[fc] $disconnect error:", e.message);
    }
    console.log("[fc] shutdown complete");
    process.exit(0);
  };
  // SIGTERM（FC 平台回收）与 SIGINT（本地/手动）同链路（CR ③）
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch((e) => { console.error("[fc] startup failed:", e); process.exit(1); });
