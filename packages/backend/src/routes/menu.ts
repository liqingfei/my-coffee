import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { listAvailableMenu } from "../services/menu.service";

export const menuRouter = Router();

// GET /api/menu?category=咖啡 — 返回可用菜单（可按分类过滤）
menuRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const category =
      typeof req.query.category === "string" ? req.query.category : undefined;
    const items = await listAvailableMenu(category);
    res.json(items);
  }),
);
