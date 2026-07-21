import { prisma } from "../src/lib/prisma";
import { MenuItem } from "@prisma/client";

// 清空所有表（用例间隔离，不依赖执行顺序）
export async function resetDb(): Promise<void> {
  await prisma.delivery.deleteMany();
  await prisma.order.deleteMany();
  await prisma.menuItem.deleteMany();
}

// 写入确定性菜单：2 款咖啡 + 1 款茶饮 + 1 款已下架
export async function seedMenu(): Promise<{
  americana: MenuItem;
  latte: MenuItem;
  tea: MenuItem;
  offShelf: MenuItem;
}> {
  const americana = await prisma.menuItem.create({
    data: { name: "美式咖啡", description: "经典黑咖啡", price: 18, category: "咖啡", available: true },
  });
  const latte = await prisma.menuItem.create({
    data: { name: "拿铁", description: "浓缩加牛奶", price: 24, category: "咖啡", available: true },
  });
  const tea = await prisma.menuItem.create({
    data: { name: "伯爵红茶", description: "英式红茶", price: 20, category: "茶饮", available: true },
  });
  const offShelf = await prisma.menuItem.create({
    data: { name: "季节限定", description: "已下架", price: 30, category: "咖啡", available: false },
  });
  return { americana, latte, tea, offShelf };
}

export const customer = {
  customerName: "张三",
  customerPhone: "13800000000",
  customerAddress: "杭州市西湖区文一西路 100 号",
};
