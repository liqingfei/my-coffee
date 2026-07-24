import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { useDeliveryAssign } from "../hooks/useDeliveryAssign";
import { useDeliveryStatusPush } from "../hooks/useDeliveryStatusPush";
import { useRole } from "../hooks/useRole";
import type { Delivery } from "../types";
import { DELIVERY_FLOW, DELIVERY_STATUS_LABEL, nextDeliveryStatus } from "../types";

// 配送追踪页：时间线 + 顾客信息；按角色条件渲染操作区（Scene 3 决策 3，同页不拆分）：
//   管理员：可推进 + 分配配送员；配送员：仅可推进分配给自己的单；顾客：只读。
// 注：本期后端无权限校验，按钮可见性仅为 UI 隔离，非安全边界（决策 5）。
export function DeliveryPage() {
  const { id } = useParams();
  const { role, person } = useRole();
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [loadError, setLoadError] = useState("");
  const [assignName, setAssignName] = useState("");

  const load = useCallback(() => {
    api
      .getDelivery(id!)
      .then(setDelivery)
      .catch((e) => setLoadError((e as Error).message));
  }, [id]);

  useEffect(load, [load]);

  const { push, pushing, error: pushError } = useDeliveryStatusPush(load);
  const { assign, assigning, error: assignError } = useDeliveryAssign(load);

  if (loadError) return <p className="error">{loadError}</p>;
  if (!delivery) return <p>加载中…</p>;

  const currentIdx = DELIVERY_FLOW.indexOf(delivery.status);
  const next = nextDeliveryStatus(delivery.status);
  const canPush =
    role === "admin" ||
    (role === "courier" && !!person && delivery.deliveryPerson === person);
  const canAssign = role === "admin";

  return (
    <section>
      <h1>配送追踪 #{delivery.id}</h1>
      <p>关联订单 #{delivery.orderId} · 配送费 ¥{delivery.fee.toFixed(2)}</p>
      <p>
        状态：
        <span className="badge" data-testid="delivery-status" data-status={delivery.status}>
          {DELIVERY_STATUS_LABEL[delivery.status]}
        </span>{" "}
        配送员：
        <span className="badge" data-testid="delivery-person">
          {delivery.deliveryPerson ?? "未分配"}
        </span>
      </p>

      <ol className="timeline" data-testid="delivery-timeline">
        {DELIVERY_FLOW.map((s, idx) => (
          <li
            key={s}
            className={
              idx < currentIdx ? "done" : idx === currentIdx ? "current" : ""
            }
          >
            {DELIVERY_STATUS_LABEL[s]}
          </li>
        ))}
      </ol>

      {delivery.order && (
        <div className="form-block">
          <p>收货人：{delivery.order.customerName}</p>
          <p>电话：{delivery.order.customerPhone}</p>
          <p>地址：{delivery.order.customerAddress}</p>
        </div>
      )}

      {pushError && <p className="error">{pushError}</p>}
      {canPush && next && (
        <button
          type="button"
          className="btn"
          data-testid="delivery-push-btn"
          disabled={pushing === delivery.id}
          onClick={() => push(delivery)}
        >
          {pushing === delivery.id
            ? "推进中…"
            : `推进到「${DELIVERY_STATUS_LABEL[next]}」`}
        </button>
      )}
      {!next && <p>配送已完成。</p>}

      {canAssign && (
        <div className="form-block">
          {assignError && <p className="error">{assignError}</p>}
          <input
            className="person-input"
            data-testid="delivery-assign-input"
            aria-label="分配配送员姓名"
            placeholder="分配配送员姓名"
            value={assignName}
            onChange={(e) => setAssignName(e.target.value)}
          />{" "}
          <button
            type="button"
            className="btn"
            data-testid="delivery-assign-submit"
            disabled={assigning || !assignName.trim()}
            onClick={() => {
              assign(delivery.id, assignName);
              setAssignName("");
            }}
          >
            {assigning ? "分配中…" : "分配配送员"}
          </button>
        </div>
      )}
    </section>
  );
}
