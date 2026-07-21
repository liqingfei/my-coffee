import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import type { MenuItem } from "../types";

// 下单页：选择咖啡数量 + 填写顾客信息 + 提交订单
export function OrderPage() {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [form, setForm] = useState({
    customerName: "",
    customerPhone: "",
    customerAddress: "",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .getMenu()
      .then(setMenu)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const setItemQty = (id: number, q: number) =>
    setQty((prev) => ({ ...prev, [id]: Math.max(0, q) }));

  const selected = menu.filter((m) => (qty[m.id] ?? 0) > 0);
  // 仅用于展示参考；最终 totalPrice 由服务端权威计算
  const estimate = selected.reduce((s, m) => s + m.price * (qty[m.id] ?? 0), 0);

  const formValid =
    selected.length > 0 &&
    form.customerName.trim() !== "" &&
    form.customerPhone.trim() !== "" &&
    form.customerAddress.trim() !== "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!formValid || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const order = await api.createOrder({
        items: selected.map((m) => ({ menuItemId: m.id, quantity: qty[m.id] })),
        customerName: form.customerName.trim(),
        customerPhone: form.customerPhone.trim(),
        customerAddress: form.customerAddress.trim(),
      });
      navigate(`/orders/${order.id}`, { state: { fromSubmit: true } });
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <section>
      <h1>下单</h1>
      {error && <p className="error">{error}</p>}
      {loading && <p>加载菜单中…</p>}
      {!loading && menu.length === 0 && <p>暂无可点商品</p>}
      {!loading && menu.length > 0 && (
      <form onSubmit={submit}>
        <div className="grid">
          {menu.map((item) => (
            <article key={item.id} className="card">
              <h3>{item.name}</h3>
              <p className="desc">{item.description}</p>
              <div className="card-foot">
                <span className="price">¥{item.price.toFixed(2)}</span>
                <span className="qty">
                  <button type="button" onClick={() => setItemQty(item.id, (qty[item.id] ?? 0) - 1)}>
                    −
                  </button>
                  <span>{qty[item.id] ?? 0}</span>
                  <button type="button" onClick={() => setItemQty(item.id, (qty[item.id] ?? 0) + 1)}>
                    +
                  </button>
                </span>
              </div>
            </article>
          ))}
        </div>

        <fieldset className="form-block">
          <legend>顾客信息</legend>
          <label>
            姓名
            <input
              value={form.customerName}
              onChange={(e) => setForm({ ...form, customerName: e.target.value })}
              placeholder="张三"
            />
          </label>
          <label>
            电话
            <input
              value={form.customerPhone}
              onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
              placeholder="13800000000"
            />
          </label>
          <label>
            地址
            <input
              value={form.customerAddress}
              onChange={(e) => setForm({ ...form, customerAddress: e.target.value })}
              placeholder="杭州市西湖区文一西路 100 号"
            />
          </label>
        </fieldset>

        <div className="summary">
          <span>已选 {selected.length} 种 / 共 {selected.reduce((s, m) => s + qty[m.id], 0)} 件</span>
          <span>预估 ¥{estimate.toFixed(2)}（最终以服务端计算为准）</span>
        </div>
        {!formValid && (
          <p className="hint">请至少选择 1 件商品并完整填写姓名、电话、地址</p>
        )}
        <button className="btn" type="submit" disabled={!formValid || submitting}>
          {submitting ? "提交中…" : "提交订单"}
        </button>
      </form>
      )}
    </section>
  );
}
