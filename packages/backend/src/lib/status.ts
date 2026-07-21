import { badRequest } from "./errors";

// 订单状态机：pending -> confirmed -> preparing -> delivering -> completed
export const ORDER_FLOW = [
  "pending",
  "confirmed",
  "preparing",
  "delivering",
  "completed",
] as const;

// 配送状态机：pending -> picked_up -> in_transit -> delivered
export const DELIVERY_FLOW = [
  "pending",
  "picked_up",
  "in_transit",
  "delivered",
] as const;

export type OrderStatus = (typeof ORDER_FLOW)[number];
export type DeliveryStatus = (typeof DELIVERY_FLOW)[number];

// 校验状态流转：目标状态必须合法，且必须是当前状态的下一个合法状态（一期为线性流转）。
// 非法跳变抛 400，满足 QA「状态机流转无非法跳变」门禁。
export function assertTransition(
  flow: readonly string[],
  current: string,
  next: string,
  label: string,
): void {
  const nextIdx = flow.indexOf(next);
  if (nextIdx === -1) {
    throw badRequest(`非法的${label}状态：${next}（合法值：${flow.join("/")}）`);
  }
  const curIdx = flow.indexOf(current);
  if (nextIdx !== curIdx + 1) {
    throw badRequest(
      `非法的${label}状态流转：${current} -> ${next}（仅允许流转到下一状态 ${
        flow[curIdx + 1] ?? "（已是终态）"
      }）`,
    );
  }
}
