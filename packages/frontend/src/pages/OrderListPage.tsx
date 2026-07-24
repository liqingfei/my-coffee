import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useCreateDelivery } from "../hooks/useCreateDelivery";
import { useDeliveryStatusPush } from "../hooks/useDeliveryStatusPush";
import { useRole } from "../hooks/useRole";
import type { Order, OrderStatus } from "../types";
import {
  DELIVERY_STATUS_LABEL,
  ORDER_STATUS_LABEL,
  nextDeliveryStatus,
} from "../types";

// 筛选 chip：value 用 OrderStatus 原始枚举（非中文标签），本地 filter 按 o.status 匹配，
// 避免「拿标签串过滤原始枚举」导致静默返回空（QA 审阅风险点）。value="" 表示全部。
const STATUS_FILTERS: Array<{ value: OrderStatus | ""; label: string }> = [
  { value: "", label: "全部" },
  { value: "pending", label: ORDER_STATUS_LABEL.pending },
  { value: "confirmed", label: ORDER_STATUS_LABEL.confirmed },
  { value: "preparing", label: ORDER_STATUS_LABEL.preparing },
  { value: "delivering", label: ORDER_STATUS_LABEL.delivering },
  { value: "completed", label: ORDER_STATUS_LABEL.completed },
];

// 订单列表页：全量拉取一次，前端本地按状态筛选（与 MenuPage 模式一致，chip 切换无网络往返）。
// 操作列：查看详情（常驻）+ 创建配送（仅 order.delivery==null）+ 推进配送（管理员、已有配送单且非终态）。
export function OrderListPage() {
  const { role } = useRole();
  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState<OrderStatus | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    api
      .listOrders()
      .then(setOrders)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const { createDelivery, creating, error: deliveryError } =
    useCreateDelivery(load);
  const { push, pushing, error: pushError } = useDeliveryStatusPush(load);

  const visible = useMemo(
    () => (status ? orders.filter((o) => o.status === status) : orders),
    [orders, status],
  );

  if (loading) return <p>加载订单中…</p>;
  if (error) return <p className="error">加载失败：{error}</p>;

  return (
    <section>
      <h1>订单列表</h1>
      {deliveryError && <p className="error">{deliveryError}</p>}
      {pushError && <p className="error">{pushError}</p>}
      <div className="filters">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value || "all"}
            className={status === f.value ? "chip active" : "chip"}
            onClick={() => setStatus(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>订单号</th>
            <th>顾客</th>
            <th>状态</th>
            <th>配送</th>
            <th>金额</th>
            <th>时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((o) => {
            const d = o.delivery;
            const next = d ? nextDeliveryStatus(d.status) : null;
            return (
              <tr key={o.id}>
                <td>#{o.id}</td>
                <td>{o.customerName}</td>
                <td>
                  <span className="badge">{ORDER_STATUS_LABEL[o.status]}</span>
                </td>
                <td>
                  {d ? (
                    <>
                      <span
                        className="badge"
                        data-testid="delivery-status"
                        data-status={d.status}
                      >
                        {DELIVERY_STATUS_LABEL[d.status]}
                      </span>{" "}
                      <span data-testid="delivery-person">
                        {d.deliveryPerson ?? "未分配"}
                      </span>
                    </>
                  ) : (
                    "-"
                  )}
                </td>
                <td>¥{o.totalPrice.toFixed(2)}</td>
                <td>{new Date(o.createdAt).toLocaleString()}</td>
                <td>
                  <Link className="btn" to={`/orders/${o.id}`}>
                    查看详情
                  </Link>{" "}
                  {o.delivery == null && (
                    <button
                      className="btn"
                      disabled={creating}
                      onClick={() => createDelivery(o.id)}
                    >
                      创建配送
                    </button>
                  )}
                  {d && role === "admin" && next && (
                    <button
                      className="btn"
                      data-testid="delivery-push-btn"
                      disabled={pushing === d.id}
                      onClick={() => push(d)}
                    >
                      推进到「{DELIVERY_STATUS_LABEL[next]}」
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {visible.length === 0 && (
            <tr>
              <td colSpan={7}>暂无订单</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
