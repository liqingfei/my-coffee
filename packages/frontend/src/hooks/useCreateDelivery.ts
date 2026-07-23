import { useState } from "react";
import { api } from "../api";

// 创建配送单的共享逻辑：配送费 ¥5，创建前 window.confirm 二次确认（P0-1 口径）。
// OrderDetailPage 与 OrderListPage 复用，避免同一写操作逻辑散落多处（Scene 3 决策口径）。
// onCreated：创建成功后的刷新回调（两页都传各自的 load，重拉数据使按钮随 delivery 状态消失）。
export function useCreateDelivery(onCreated: () => void) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const createDelivery = async (orderId: number) => {
    if (creating) return;
    if (!window.confirm("确认创建配送单？配送费 ¥5.00。")) return;
    setCreating(true);
    setError("");
    try {
      await api.createDelivery(orderId);
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return { createDelivery, creating, error };
}
