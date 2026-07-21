import { createApp } from "./app";
import { prisma } from "./lib/prisma";

const port = Number(process.env.PORT ?? 3001);
const app = createApp();

async function main() {
  // 预热 Prisma 连接：让查询引擎与 SQLite 连接在首个请求前就绪，
  // 避免冷启动竞态导致首请求偶发 500（QA 验收追踪项）。
  await prisma.$connect();
  // listen 的 'error'（如 EADDRINUSE）是异步事件，需显式捕获走统一启动失败处理，
  // 否则会成为未处理的 error 事件直接崩溃。
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`[my-coffee backend] listening on http://localhost:${port}`);
      resolve();
    });
    server.on("error", reject);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[startup failed]", err);
  process.exit(1);
});
