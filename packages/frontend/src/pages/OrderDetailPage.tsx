import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api } from "../api";
import { useCreateDelivery } from "../hooks/useCreateDelivery";
import { useDeliveryAssign } from "../hooks/useDeliveryAssign";
import { useDeliveryStatusPush } from "../hooks/useDeliveryStatusPush";
import { useRole } from "../hooks/useRole";
import type { Order } from "../types";
import {
  DELIVERY_STATUS_LABEL,
  ORDER_STATUS_LABEL,
  nextDeliveryStatus,
} from "../types";

// 订单详情页：订单状态、商品明细、配送信息（可创建配送单 / 推进配送 / 分配配送员）
export function OrderDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const { role, person } = useRole();
  const [order, setOrder] = useState<Order | null>(null);
  const [loadError, setLoadError] = useState("");
  const [assignName, setAssignName] = useState("");
  // P0-3：下单成功跳转过来时显示成功 banner（直接访问 URL 不显示）
  const [showSuccess, setShowSuccess] = useState(
    Boolean((location.state as { fromSubmit?: boolean } | null)?.fromSubmit)
  );

  const load = useCallback(() => {
    api
      .getOrder(id!)
      .then(setOrder)
      .catch((e) => setLoadError((e as Error).message));
  }, [id]);

  useEffect(load, [load]);

  // P0-1：涉及 ¥5 费用，创建前二次确认（取消则不发请求）——复用共享 hook，与 OrderListPage 同源
  const { createDelivery, creating, error: deliveryError } =
    useCreateDelivery(load);
  const { push, pushing, error: pushError } = useDeliveryStatusPush(load);
  const { assign, assigning, error: assignError } = useDeliveryAssign(load);

  const error = loadError || deliveryError;
  if (error) return <p className="error">{error}</p>;
  if (!order) return <p>加载中…</p>;

  // 配送操作权限（UI 隔离，非安全边界）：管理员可推进+分配；配送员仅推进己方单；顾客只读。
  const d = order.delivery;
  const canPush =
    role === "admin" ||
    (role === "courier" && !!person && d?.deliveryPerson === person);
  const canAssign = role === "admin";
  const next = d ? nextDeliveryStatus(d.status) : null;

  return (
    <section>
      <h1>订单 #{order.id}</h1>
      {showSuccess && (
        <div className="banner-success">
          <span>✅ 订单提交成功！</span>
          <button
            type="button"
            className="banner-close"
            aria-label="关闭"
            onClick={() => setShowSuccess(false)}
          >
            ×
          </button>
        </div>
      )}
      <p>
        状态：<span className="badge">{ORDER_STATUS_LABEL[order.status]}</span>
      </p>

      <table className="table">
        <thead>
          <tr>
            <th>商品</th>
            <th>单价</th>
            <th>数量</th>
            <th>小计</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((it) => (
            <tr key={it.menuItemId}>
              <td>{it.name}</td>
              <td>¥{it.price.toFixed(2)}</td>
              <td>{it.quantity}</td>
              <td>¥{it.subtotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>合计</td>
            <td>¥{order.totalPrice.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>

      <div className="form-block">
        <p>顾客：{order.customerName}</p>
        <p>电话：{order.customerPhone}</p>
        <p>地址：{order.customerAddress}</p>
      </div>

      <h2>配送</h2>
      {d ? (
        <>
          <p>
            配送单 #{d.id}，状态{" "}
            <span
              className="badge"
              data-testid="delivery-status"
              data-status={d.status}
            >
              {DELIVERY_STATUS_LABEL[d.status]}
            </span>{" "}
            配送员：
            <span className="badge" data-testid="delivery-person">
              {d.deliveryPerson ?? "未分配"}
            </span>
          </p>
          {pushError && <p className="error">{pushError}</p>}
          {canPush && next && (
            <button
              type="button"
              className="btn"
              data-testid="delivery-push-btn"
              disabled={pushing === d.id}
              onClick={() => push(d)}
            >
              {pushing === d.id
                ? "推进中…"
                : `推进到「${DELIVERY_STATUS_LABEL[next]}」`}
            </button>
          )}{" "}
          <Link className="btn" to={`/delivery/${d.id}`}>
            查看配送追踪 →
          </Link>
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
                  assign(d.id, assignName);
                  setAssignName("");
                }}
              >
                {assigning ? "分配中…" : "分配配送员"}
              </button>
            </div>
          )}
        </>
      ) : (
        <button
          className="btn"
          onClick={() => createDelivery(order.id)}
          disabled={creating}
        >
          {creating ? "创建中…" : "创建配送单（¥5.00）"}
        </button>
      )}
    </section>
  );
}
