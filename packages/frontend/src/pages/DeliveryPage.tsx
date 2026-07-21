import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import type { Delivery, DeliveryStatus } from "../types";
import { DELIVERY_STATUS_LABEL } from "../types";

const FLOW: DeliveryStatus[] = ["pending", "picked_up", "in_transit", "delivered"];

// 配送追踪页：配送状态时间线 + 订单顾客信息
export function DeliveryPage() {
  const { id } = useParams();
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .getDelivery(id!)
      .then(setDelivery)
      .catch((e) => setError((e as Error).message));
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!delivery) return <p>加载中…</p>;

  const currentIdx = FLOW.indexOf(delivery.status);

  return (
    <section>
      <h1>配送追踪 #{delivery.id}</h1>
      <p>
        关联订单 #{delivery.orderId} · 配送费 ¥{delivery.fee.toFixed(2)}
      </p>

      <ol className="timeline">
        {FLOW.map((s, idx) => (
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
    </section>
  );
}
