import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { MenuItem } from "../types";

// 菜单浏览页：展示可用咖啡，支持按分类筛选
export function MenuPage() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .getMenu()
      .then(setItems)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const categories = useMemo(
    () => Array.from(new Set(items.map((i) => i.category))),
    [items],
  );
  const visible = category ? items.filter((i) => i.category === category) : items;

  if (loading) return <p>加载菜单中…</p>;
  if (error) return <p className="error">加载失败：{error}</p>;

  return (
    <section>
      <h1>咖啡菜单</h1>
      <div className="filters">
        <button
          className={category === "" ? "chip active" : "chip"}
          onClick={() => setCategory("")}
        >
          全部
        </button>
        {categories.map((c) => (
          <button
            key={c}
            className={category === c ? "chip active" : "chip"}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="grid">
        {visible.map((item) => (
          <article key={item.id} className="card">
            <h3>{item.name}</h3>
            <p className="desc">{item.description}</p>
            <div className="card-foot">
              <span className="price">¥{item.price.toFixed(2)}</span>
              <span className="tag">{item.category}</span>
            </div>
          </article>
        ))}
        {visible.length === 0 && <p>该分类暂无商品</p>}
      </div>
      <p>
        <Link className="btn" to="/order">
          去下单 →
        </Link>
      </p>
    </section>
  );
}
