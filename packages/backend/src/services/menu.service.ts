import { prisma } from "../lib/prisma";
import { MenuItem } from "@prisma/client";

// 菜单响应：price 读边界 Decimal→number，线协议 JSON number、前端零改动（A2 §2）
export type MenuResponse = Omit<MenuItem, "price"> & { price: number };

// 菜单查询：返回所有可用(available=true)菜单项，支持按分类过滤。
// 一期 GET /api/menu 只暴露可点商品；不可用商品仅在管理场景有意义，不在本期范围。
export async function listAvailableMenu(
  category?: string,
): Promise<MenuResponse[]> {
  const where = category ? { available: true, category } : { available: true };
  const rows = await prisma.menuItem.findMany({ where, orderBy: { id: "asc" } });
  return rows.map((m) => ({ ...m, price: Number(m.price) }));
}
