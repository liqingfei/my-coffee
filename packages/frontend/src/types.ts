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
