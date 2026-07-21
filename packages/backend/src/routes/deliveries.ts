import { Router } from "express";
import { asyncHandler, parseId } from "../lib/asyncHandler";
import { badRequest } from "../lib/errors";
import {
  createDelivery,
  getDelivery,
  transitionDeliveryStatus,
} from "../services/delivery.service";

export const deliveriesRouter = Router();

// POST /api/deliveries — 创建配送单（body: {orderId}，顾客信息继承自订单）
deliveriesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const delivery = await createDelivery(req.body ?? {});
    res.status(201).json(delivery);
  }),
);

// GET /api/deliveries/:id — 配送状态查询
deliveriesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const delivery = await getDelivery(parseId(req.params.id));
    res.json(delivery);
  }),
);

// PATCH /api/deliveries/:id/status — 受控状态流转
deliveriesRouter.patch(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const next = (req.body ?? {}).status;
    if (typeof next !== "string") {
      throw badRequest("缺少 body.status");
    }
    const delivery = await transitionDeliveryStatus(parseId(req.params.id), next);
    res.json(delivery);
  }),
);
