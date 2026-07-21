import { Delivery, Order } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { badRequest, notFound } from "../lib/errors";
import { ORDER_FLOW, assertTransition } from "../lib/status";
import { serializeDelivery } from "./delivery.service";

// 订单项（落库为 JSON 字符串，响应时反序列化回数组）
export interface OrderItem {
  menuItemId: number;
  name: string;
  quantity: number;
  price: number; // 下单时刻的单价快照（取自 DB，非客户端）
  subtotal: number;
}

export interface CreateOrderInput {
  items: Array<{ menuItemId: unknown; quantity: unknown }>;
  customerName: unknown;
  customerPhone: unknown;
  customerAddress: unknown;
}

// 序列化的订单响应：items 反序列化为数组，totalPrice 读边界转 number，并内嵌 delivery（如有）
export type OrderResponse = Omit<Order, "items" | "totalPrice"> & {
  totalPrice: number;
  items: OrderItem[];
  delivery?: unknown;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest(`缺少必填字段或字段为空：${field}`);
  }
  return value.trim();
}

function serializeOrder(
  order: Order & { delivery?: unknown },
): OrderResponse {
  // items 经 JSON.parse 回来已是 number（price/subtotal 在 stringify 前已转），别再转
  const items = JSON.parse(order.items) as OrderItem[];
  return {
    ...order,
    totalPrice: Number(order.totalPrice), // 读边界转换：Decimal→number
    items,
    // 嵌套 delivery.fee 同走读边界转换，复用 serializeDelivery（一次转换、两处出口）；
    // delivery?: unknown 是 createOrder（无 include）与 list/get（include）两种形态的联合，
    // 调用点结构化 cast 为 Delivery，禁改 any（CR tsc 处方）。
    delivery: order.delivery
      ? serializeDelivery(order.delivery as Delivery)
      : null,
  };
}

// 创建订单。totalPrice 由服务端按 DB 单价权威重算，忽略客户端传入的任何价格字段。
export async function createOrder(
  input: CreateOrderInput,
): Promise<OrderResponse> {
  const customerName = requireNonEmptyString(input.customerName, "customerName");
  const customerPhone = requireNonEmptyString(input.customerPhone, "customerPhone");
  const customerAddress = requireNonEmptyString(
    input.customerAddress,
    "customerAddress",
  );

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw badRequest("订单至少包含一个商品项（items 不能为空）");
  }

  const orderItems: OrderItem[] = [];
  let totalPrice = 0;

  for (const raw of input.items) {
    const menuItemId = Number(raw?.menuItemId);
    const quantity = Number(raw?.quantity);

    if (!Number.isInteger(menuItemId) || menuItemId <= 0) {
      throw badRequest("商品项 menuItemId 非法");
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw badRequest(`商品 ${menuItemId} 的 quantity 必须为正整数`);
    }

    const menuItem = await prisma.menuItem.findUnique({ where: { id: menuItemId } });
    if (!menuItem) {
      throw badRequest(`商品不存在：menuItemId=${menuItemId}`);
    }
    if (!menuItem.available) {
      throw badRequest(`商品已下架，不可点：${menuItem.name}`);
    }

    // 读边界转换：Decimal→number，subtotal 计算与 items 价格快照共用
    const unitPrice = Number(menuItem.price);
    const subtotal = round2(unitPrice * quantity);
    totalPrice += subtotal;
    orderItems.push({
      menuItemId: menuItem.id,
      name: menuItem.name,
      quantity,
      price: unitPrice,
      subtotal,
    });
  }

  const order = await prisma.order.create({
    data: {
      items: JSON.stringify(orderItems),
      totalPrice: round2(totalPrice),
      status: "pending",
      customerName,
      customerPhone,
      customerAddress,
    },
  });

  return serializeOrder(order);
}

export async function listOrders(status?: string): Promise<OrderResponse[]> {
  const where = status ? { status } : {};
  const orders = await prisma.order.findMany({
    where,
    orderBy: { id: "desc" },
    include: { delivery: true },
  });
  return orders.map(serializeOrder);
}

export async function getOrder(id: number): Promise<OrderResponse> {
  const order = await prisma.order.findUnique({
    where: { id },
    include: { delivery: true },
  });
  if (!order) {
    throw notFound(`订单不存在：id=${id}`);
  }
  return serializeOrder(order);
}

// 受控状态流转：仅允许流转到状态机中的下一状态，非法跳变抛 400。
export async function transitionOrderStatus(
  id: number,
  next: string,
): Promise<OrderResponse> {
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) {
    throw notFound(`订单不存在：id=${id}`);
  }
  assertTransition(ORDER_FLOW, order.status, next, "订单");
  const updated = await prisma.order.update({
    where: { id },
    data: { status: next },
    include: { delivery: true },
  });
  return serializeOrder(updated);
}
