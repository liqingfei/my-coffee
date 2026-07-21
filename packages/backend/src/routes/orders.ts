import { Router } from "express";
import { asyncHandler, parseId } from "../lib/asyncHandler";
import { badRequest } from "../lib/errors";
import {
  createOrder,
  getOrder,
  listOrders,
  transitionOrderStatus,
} from "../services/order.service";

export const ordersRouter = Router();

// POST /api/orders — 创建订单（totalPrice 服务端权威重算）
ordersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const order = await createOrder(req.body ?? {});
    res.status(201).json(order);
  }),
);

// GET /api/orders?status=pending — 订单列表（可按状态过滤）
ordersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const status =
      typeof req.query.status === "string" ? req.query.status : undefined;
    const orders = await listOrders(status);
    res.json(orders);
  }),
);

// GET /api/orders/:id — 订单详情（含关联配送单）
ordersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const order = await getOrder(parseId(req.params.id));
    res.json(order);
  }),
);

// PATCH /api/orders/:id/status — 受控状态流转
ordersRouter.patch(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const next = (req.body ?? {}).status;
    if (typeof next !== "string") {
      throw badRequest("缺少 body.status");
    }
    const order = await transitionOrderStatus(parseId(req.params.id), next);
    res.json(order);
  }),
);
