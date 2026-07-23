import type { Delivery, MenuItem, Order } from "./types";

// 统一请求封装：非 2xx 抛 Error（携带后端 error 文案）
async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body as { error?: string })?.error ?? `请求失败(${res.status})`);
  }
  return body as T;
}

export const api = {
  getMenu: (category?: string) =>
    http<MenuItem[]>(`/api/menu${category ? `?category=${encodeURIComponent(category)}` : ""}`),

  createOrder: (payload: {
    items: Array<{ menuItemId: number; quantity: number }>;
    customerName: string;
    customerPhone: string;
    customerAddress: string;
  }) => http<Order>("/api/orders", { method: "POST", body: JSON.stringify(payload) }),

  getOrder: (id: string | number) => http<Order>(`/api/orders/${id}`),

  listOrders: (status?: string) =>
    http<Order[]>(
      `/api/orders${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    ),

  createDelivery: (orderId: number) =>
    http<Delivery>("/api/deliveries", { method: "POST", body: JSON.stringify({ orderId }) }),

  getDelivery: (id: string | number) => http<Delivery>(`/api/deliveries/${id}`),
};
