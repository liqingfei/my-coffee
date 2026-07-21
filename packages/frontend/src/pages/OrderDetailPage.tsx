import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import type { Order } from "../types";
import { ORDER_STATUS_LABEL } from "../types";

// 订单详情页：订单状态、商品明细、配送信息（可创建配送单）
export function OrderDetailPage() {
  const { id } = useParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api
      .getOrder(id!)
      .then(setOrder)
      .catch((e) => setError((e as Error).message));
  }, [id]);

  useEffect(load, [load]);

  const createDelivery = async () => {
    if (!order || creating) return;
    setCreating(true);
    setError("");
    try {
      await api.createDelivery(order.id);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  if (error) return <p className="error">{error}</p>;
  if (!order) return <p>加载中…</p>;

  return (
    <section>
      <h1>订单 #{order.id}</h1>
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
        <button className="btn" onClick={createDelivery} disabled={creating}>
          {creating ? "创建中…" : "创建配送单（¥5.00）"}
        </button>
      )}
    </section>
  );
}
