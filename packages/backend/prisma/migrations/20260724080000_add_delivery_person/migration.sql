-- AlterTable
-- 配送单新增配送员字段：null=未分配。本期 UI 角色模拟、后端无权限校验，仅前端隔离。
-- down（可逆）：ALTER TABLE "Delivery" DROP COLUMN "deliveryPerson";（Prisma 经 migrate reset/shadow 验证）
ALTER TABLE "Delivery" ADD COLUMN "deliveryPerson" VARCHAR(100);
