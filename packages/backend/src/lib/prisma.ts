import { PrismaClient } from "@prisma/client";

// Prisma client 单例，避免开发热重载时创建过多连接实例
export const prisma = new PrismaClient();
