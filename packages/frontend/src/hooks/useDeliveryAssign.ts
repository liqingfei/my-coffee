import { useState } from "react";
import { api } from "../api";

// 分配配送员的共享逻辑：调 PATCH /:id/assign，成功后 onChanged 重拉使回显生效。
// 空姓名前端直接拦截（不发请求），后端另有 400 兜底。不做乐观更新。
export function useDeliveryAssign(onChanged: () => void) {
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState("");

  const assign = async (id: number, name: string) => {
    const person = name.trim();
    if (!person || assigning) return;
    setAssigning(true);
    setError("");
    try {
      await api.assignDeliveryPerson(id, person);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAssigning(false);
    }
  };

  return { assign, assigning, error };
}
