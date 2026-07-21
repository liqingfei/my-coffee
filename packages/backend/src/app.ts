import express from "express";
import { menuRouter } from "./routes/menu";
import { ordersRouter } from "./routes/orders";
import { deliveriesRouter } from "./routes/deliveries";
import { errorHandler } from "./lib/errors";

// 组装 Express 应用（不监听端口，便于 supertest 直接注入）
export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/menu", menuRouter);
  app.use("/api/orders", ordersRouter);
  app.use("/api/deliveries", deliveriesRouter);

  // 未知 /api 路由返回 404（非 /api 路径交由前端/静态托管处理）
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API 路由不存在" });
  });

  app.use(errorHandler);
  return app;
}
