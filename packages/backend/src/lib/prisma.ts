import { PrismaClient } from "@prisma/client";

// Prisma client 单例，避免开发热重载时创建过多连接实例。
// 数据库连接单一事实源：显式读 process.env.DATABASE_URL
// （连接池参数 connection_limit 钉在 URL 串尾，A2 §3；不在此另读 env）。
export const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});
