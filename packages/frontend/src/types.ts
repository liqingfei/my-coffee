export interface MenuItem {
  id: number;
  name: string;
  description: string;
  price: number;
  category: string;
  imageUrl: string | null;
  available: boolean;
  createdAt: string;
}

export interface OrderItem {
  menuItemId: number;
  name: string;
  quantity: number;
  price: number;
  subtotal: number;
}

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "delivering"
  | "completed";

export type DeliveryStatus =
  | "pending"
  | "picked_up"
  | "in_transit"
  | "delivered";

export interface Delivery {
  id: number;
  orderId: number;
  status: DeliveryStatus;
  fee: number;
  estimatedTime: number | null;
  deliveryPerson: string | null;
  createdAt: string;
  order?: {
    id: number;
    customerName: string;
    customerPhone: string;
    customerAddress: string;
    status: OrderStatus;
  };
}

export interface Order {
  id: number;
  items: OrderItem[];
  totalPrice: number;
  status: OrderStatus;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  createdAt: string;
  delivery: Delivery | null;
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "待确认",
  confirmed: "已确认",
  preparing: "制作中",
  delivering: "配送中",
  completed: "已完成",
};

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  pending: "待取货",
  picked_up: "已取货",
  in_transit: "配送中",
  delivered: "已送达",
};

// 配送状态线性流转序列（与后端 DELIVERY_FLOW 对齐）：pending→picked_up→in_transit→delivered
export const DELIVERY_FLOW: DeliveryStatus[] = [
  "pending",
  "picked_up",
  "in_transit",
  "delivered",
];

// 取下一合法配送状态；已是终态 delivered 返回 null（用于禁用推进按钮）。
// 前端仅算「下一步」，真正的状态机校验仍在后端 assertTransition（权威）。
export function nextDeliveryStatus(status: DeliveryStatus): DeliveryStatus | null {
  const idx = DELIVERY_FLOW.indexOf(status);
  return idx >= 0 && idx < DELIVERY_FLOW.length - 1 ? DELIVERY_FLOW[idx + 1] : null;
}

// UI 模拟角色（本期无真实认证，仅前端隔离）：管理员 / 配送员 / 顾客
export type Role = "admin" | "courier" | "customer";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "管理员",
  courier: "配送员",
  customer: "顾客",
};
