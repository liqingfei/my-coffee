import { Delivery, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { badRequest, conflict, notFound } from "../lib/errors";
import { DELIVERY_FLOW, assertTransition } from "../lib/status";

// 读边界转换器：fee Decimal→number，线协议序列化为 JSON number、前端零改动（A2 §2）。
// 参数签结构化泛型约束：本文件三个 return 与 order.service serializeOrder 的嵌套调用
// 复用同一转换器（一次转换、多个出口），调用点无需 any。
export function serializeDelivery<T extends { fee: Prisma.Decimal | number }>(
  d: T,
): Omit<T, "fee"> & { fee: number } {
  return { ...d, fee: Number(d.fee) };
}

// 配送响应：fee 读边界转 number；内嵌订单的顾客信息子集（配送单继承订单地址/电话，不冗余落库）
export type DeliveryResponse = Omit<Delivery, "fee"> & {
  fee: number;
  order: {
    id: number;
    customerName: string;
    customerPhone: string;
    customerAddress: string;
    status: string;
  };
};

const orderSelect = {
  id: true,
  customerName: true,
  customerPhone: true,
  customerAddress: true,
  status: true,
} as const;

// 创建配送单：关联既有订单，一期配送费固定 5 元。
// 顾客地址/电话继承自订单，因此 body 只需 orderId。
export async function createDelivery(input: {
  orderId: unknown;
}): Promise<DeliveryResponse> {
  const orderId = Number(input.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    throw badRequest("orderId 非法");
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    throw notFound(`订单不存在：id=${orderId}`);
  }

  const existing = await prisma.delivery.findUnique({ where: { orderId } });
  if (existing) {
    throw conflict(`订单已存在配送单：orderId=${orderId}`);
  }

  const delivery = await prisma.delivery.create({
    data: { orderId, fee: 5.0 },
    include: { order: { select: orderSelect } },
  });
  return serializeDelivery(delivery);
}

export async function getDelivery(id: number): Promise<DeliveryResponse> {
  const delivery = await prisma.delivery.findUnique({
    where: { id },
    include: { order: { select: orderSelect } },
  });
  if (!delivery) {
    throw notFound(`配送单不存在：id=${id}`);
  }
  return serializeDelivery(delivery);
}

// 受控状态流转：pending -> picked_up -> in_transit -> delivered
export async function transitionDeliveryStatus(
  id: number,
  next: string,
): Promise<DeliveryResponse> {
  const delivery = await prisma.delivery.findUnique({ where: { id } });
  if (!delivery) {
    throw notFound(`配送单不存在：id=${id}`);
  }
  assertTransition(DELIVERY_FLOW, delivery.status, next, "配送");
  const updated = await prisma.delivery.update({
    where: { id },
    data: { status: next },
    include: { order: { select: orderSelect } },
  });
  return serializeDelivery(updated);
}
