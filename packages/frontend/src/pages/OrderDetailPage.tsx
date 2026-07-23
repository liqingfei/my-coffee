import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api } from "../api";
import { useCreateDelivery } from "../hooks/useCreateDelivery";
import type { Order } from "../types";
import { ORDER_STATUS_LABEL } from "../types";

// 订单详情页：订单状态、商品明细、配送信息（可创建配送单）
export function OrderDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const [order, setOrder] = useState<Order | null>(null);
  const [loadError, setLoadError] = useState("");
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

  const error = loadError || deliveryError;
  if (error) return <p className="error">{error}</p>;
  if (!order) return <p>加载中…</p>;

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
      {order.delivery ? (
        <p>
          配送单 #{order.delivery.id}，状态{" "}
          <span className="badge">{order.delivery.status}</span>。{" "}
          <Link className="btn" to={`/delivery/${order.delivery.id}`}>
            查看配送追踪 →
          </Link>
        </p>
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
