import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// 初始咖啡菜单（确定性数据，便于 QA 断言）
const menu = [
  {
    name: "美式咖啡",
    description: "经典黑咖啡，浓郁醇厚",
    price: 18,
    category: "咖啡",
    imageUrl: null,
    available: true,
  },
  {
    name: "拿铁",
    description: "意式浓缩搭配丝滑牛奶",
    price: 24,
    category: "咖啡",
    imageUrl: null,
    available: true,
  },
  {
    name: "卡布奇诺",
    description: "浓缩、牛奶与奶泡的经典组合",
    price: 26,
    category: "咖啡",
    imageUrl: null,
    available: true,
  },
  {
    name: "摩卡",
    description: "咖啡与巧克力的融合",
    price: 28,
    category: "咖啡",
    imageUrl: null,
    available: true,
  },
  {
    name: "伯爵红茶",
    description: "佛手柑香气的英式红茶",
    price: 20,
    category: "茶饮",
    imageUrl: null,
    available: true,
  },
  {
    name: "提拉米苏",
    description: "手工意式甜点",
    price: 32,
    category: "甜点",
    imageUrl: null,
    available: true,
  },
  {
    name: "季节限定特调",
    description: "下架商品示例（不可点）",
    price: 30,
    category: "咖啡",
    imageUrl: null,
    available: false,
  },
];

async function main() {
  // 幂等：先清空再写入，避免重复 seed 造成重复菜单
  await prisma.delivery.deleteMany();
  await prisma.order.deleteMany();
  await prisma.menuItem.deleteMany();
  for (const item of menu) {
    await prisma.menuItem.create({ data: item });
  }
  const count = await prisma.menuItem.count();
  // eslint-disable-next-line no-console
  console.log(`Seed 完成：写入 ${count} 条菜单（含 1 条 available=false）`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
