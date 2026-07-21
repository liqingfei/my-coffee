import { prisma } from "../lib/prisma";
import { MenuItem } from "@prisma/client";

// 菜单查询：返回所有可用(available=true)菜单项，支持按分类过滤。
// 一期 GET /api/menu 只暴露可点商品；不可用商品仅在管理场景有意义，不在本期范围。
export async function listAvailableMenu(category?: string): Promise<MenuItem[]> {
  const where = category ? { available: true, category } : { available: true };
  return prisma.menuItem.findMany({ where, orderBy: { id: "asc" } });
}
