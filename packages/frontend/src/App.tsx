import { NavLink, Route, Routes } from "react-router-dom";
import { MenuPage } from "./pages/MenuPage";
import { OrderPage } from "./pages/OrderPage";
import { OrderListPage } from "./pages/OrderListPage";
import { OrderDetailPage } from "./pages/OrderDetailPage";
import { DeliveryPage } from "./pages/DeliveryPage";

export default function App() {
  return (
    <div className="app">
      <header className="header">
        <div className="container header-inner">
          <span className="brand">☕ 希希咖啡店</span>
          <nav className="nav">
            <NavLink to="/" end>
              菜单
            </NavLink>
            <NavLink to="/order">下单</NavLink>
            <NavLink to="/orders">订单</NavLink>
          </nav>
        </div>
      </header>
      <main className="container main">
        <Routes>
          <Route path="/" element={<MenuPage />} />
          <Route path="/order" element={<OrderPage />} />
          <Route path="/orders" element={<OrderListPage />} />
          <Route path="/orders/:id" element={<OrderDetailPage />} />
          <Route path="/delivery/:id" element={<DeliveryPage />} />
          <Route path="*" element={<p>页面不存在</p>} />
        </Routes>
      </main>
    </div>
  );
}
