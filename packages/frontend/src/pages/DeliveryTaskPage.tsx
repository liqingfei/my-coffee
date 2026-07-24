import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useDeliveryStatusPush } from "../hooks/useDeliveryStatusPush";
import { useRole } from "../hooks/useRole";
import type { Delivery } from "../types";
import { DELIVERY_STATUS_LABEL, nextDeliveryStatus } from "../types";

// 配送员任务页：仅显示分配给当前配送员（?person=）的配送单，可推进己方单。
// 非 courier 或未填姓名 → 引导切换角色/输入姓名（不拉数据）。
export function DeliveryTaskPage() {
  const { role, person } = useRole();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(() => {
    if (role !== "courier" || !person) {
      setDeliveries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .listDeliveries(person)
      .then(setDeliveries)
      .catch((e) => setLoadError((e as Error).message))
      .finally(() => setLoading(false));
  }, [role, person]);

  useEffect(load, [load]);

  const { push, pushing, error: pushError } = useDeliveryStatusPush(load);

  if (role !== "courier") {
    return (
      <section>
        <h1>配送任务</h1>
        <p>请在右上角切换到「配送员」角色查看任务。</p>
      </section>
    );
  }
  if (!person) {
    return (
      <section>
        <h1>配送任务</h1>
        <p>请在右上角输入配送员姓名后查看任务。</p>
      </section>
    );
  }
  if (loading) return <p>加载任务中…</p>;
  const error = loadError || pushError;
  if (error) return <p className="error">{error}</p>;

  return (
    <section>
      <h1>配送任务（{person}）</h1>
      <table className="table">
        <thead>
          <tr>
            <th>配送单</th>
            <th>订单</th>
            <th>收货人</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {deliveries.map((d) => {
            const next = nextDeliveryStatus(d.status);
            return (
              <tr key={d.id} data-testid="delivery-task-item">
                <td>#{d.id}</td>
                <td>
                  <Link to={`/orders/${d.orderId}`}>#{d.orderId}</Link>
                </td>
                <td>{d.order?.customerName ?? "-"}</td>
                <td>
                  <span className="badge" data-testid="delivery-status" data-status={d.status}>
                    {DELIVERY_STATUS_LABEL[d.status]}
                  </span>
                </td>
                <td>
                  {next ? (
                    <button
                      type="button"
                      className="btn"
                      data-testid="delivery-push-btn"
                      disabled={pushing === d.id}
                      onClick={() => push(d)}
                    >
                      推进到「{DELIVERY_STATUS_LABEL[next]}」
                    </button>
                  ) : (
                    <span className="badge">已完成</span>
                  )}{" "}
                  <Link
                    className="btn"
                    to={`/delivery/${d.id}?role=courier&person=${encodeURIComponent(person)}`}
                  >
                    追踪
                  </Link>
                </td>
              </tr>
            );
          })}
          {deliveries.length === 0 && (
            <tr>
              <td colSpan={5}>暂无分配给 {person} 的配送任务</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
