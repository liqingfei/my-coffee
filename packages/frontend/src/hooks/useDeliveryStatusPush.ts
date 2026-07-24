import { useState } from "react";
import { api } from "../api";
import type { Delivery } from "../types";
import { nextDeliveryStatus } from "../types";

// 配送状态推进的共享逻辑：算出下一合法状态并调 PATCH /:id/status，成功后 onChanged 重拉数据。
// 不做乐观更新——失败仅置 error，UI 状态不被污染（QA 边界：5xx/超时后状态不残留、可重试）。
// OrderList/OrderDetail/Delivery/DeliveryTask 四页复用，避免写操作逻辑散落多处（同 useCreateDelivery 约定）。
export function useDeliveryStatusPush(onChanged: () => void) {
  const [pushing, setPushing] = useState<number | null>(null);
  const [error, setError] = useState("");

  const push = async (delivery: Delivery) => {
    const next = nextDeliveryStatus(delivery.status);
    if (!next || pushing === delivery.id) return; // 终态 delivered 或重复点击不发请求
    setPushing(delivery.id);
    setError("");
    try {
      await api.updateDeliveryStatus(delivery.id, next);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPushing(null);
    }
  };

  return { push, pushing, error };
}
