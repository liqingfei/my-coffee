import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import type { Role } from "../types";

const ROLES: Role[] = ["admin", "courier", "customer"];

// 角色状态唯一事实源 = URL search params（?role=&person=）。
// 选 URL 而非 Context/localStorage：刷新天然保留、可深链直达、E2E 可直接定位与断言，
// 避免全局 store 的残留与不可断言问题（Scene 3 决策 1/2 口径）。
export function useRole() {
  const [params, setParams] = useSearchParams();

  const raw = params.get("role");
  const role: Role = ROLES.includes(raw as Role) ? (raw as Role) : "admin";
  const person = params.get("person") ?? "";

  // 切角色：非 courier 时清掉 person，避免残留无效身份参数
  const setRole = useCallback(
    (next: Role) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set("role", next);
          if (next !== "courier") p.delete("person");
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // 设置配送员姓名（隐含切到 courier）：空串则移除 person
  const setPerson = useCallback(
    (name: string) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set("role", "courier");
          if (name) p.set("person", name);
          else p.delete("person");
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return { role, person, setRole, setPerson };
}
