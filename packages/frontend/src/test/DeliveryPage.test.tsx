import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { DeliveryPage } from "../pages/DeliveryPage";
import type { Delivery } from "../types";
import { canPushDelivery } from "../types";

vi.mock("../api", () => ({
  api: {
    getDelivery: vi.fn(),
    updateDeliveryStatus: vi.fn(),
    assignDeliveryPerson: vi.fn(),
  },
}));

function makeDelivery(over: Partial<Delivery> = {}): Delivery {
  return {
    id: 5,
    orderId: 13,
    status: "pending",
    fee: 5,
    estimatedTime: null,
    deliveryPerson: "张三",
    createdAt: "2026-07-24T00:00:00.000Z",
    order: {
      id: 13,
      customerName: "顾客A",
      customerPhone: "138",
      customerAddress: "某地",
      status: "delivering",
    },
    ...over,
  };
}

// DeliveryPage 用 useParams 取 :id，useRole 读 search params → 需 Route + MemoryRouter。
function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/delivery/:id" element={<DeliveryPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getDelivery).mockResolvedValue(makeDelivery());
});
afterEach(() => vi.restoreAllMocks());

// Scene 6 审查 C：隔离边界守卫 deliveryPerson===person 之前只靠 E2E 兜，补单元覆盖。
describe("DeliveryPage 三角色渲染（隔离边界守卫）", () => {
  it("admin：推进按钮 + 分配表单均渲染", async () => {
    renderAt("/delivery/5?role=admin");
    expect(await screen.findByTestId("delivery-push-btn")).toBeInTheDocument();
    expect(screen.getByTestId("delivery-assign-input")).toBeInTheDocument();
    expect(screen.getByTestId("delivery-assign-submit")).toBeInTheDocument();
    expect(screen.getByTestId("delivery-timeline")).toBeInTheDocument();
  });

  it("courier 己方单（person=张三=deliveryPerson）：推进按钮渲染，无分配表单", async () => {
    renderAt("/delivery/5?role=courier&person=张三");
    expect(await screen.findByTestId("delivery-push-btn")).toBeInTheDocument();
    expect(
      screen.queryByTestId("delivery-assign-input"),
    ).not.toBeInTheDocument();
  });

  it("courier 他人单（person=李四≠deliveryPerson=张三）：无推进按钮（守卫生效）", async () => {
    renderAt("/delivery/5?role=courier&person=李四");
    // 等页面渲染完成（时间线出现），再断言推进按钮不存在
    await screen.findByTestId("delivery-timeline");
    expect(screen.queryByTestId("delivery-push-btn")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("delivery-assign-input"),
    ).not.toBeInTheDocument();
  });

  it("customer：全只读，无推进按钮、无分配表单", async () => {
    renderAt("/delivery/5?role=customer");
    await screen.findByTestId("delivery-timeline");
    expect(screen.queryByTestId("delivery-push-btn")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("delivery-assign-input"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("delivery-assign-submit"),
    ).not.toBeInTheDocument();
  });
});

describe("canPushDelivery（推进权限纯函数，守卫核心）", () => {
  it("admin 恒可推进（无视 person/deliveryPerson）", () => {
    expect(canPushDelivery("admin", "", "张三")).toBe(true);
    expect(canPushDelivery("admin", "", null)).toBe(true);
  });

  it("courier 仅当 person 非空且与 deliveryPerson 相等", () => {
    expect(canPushDelivery("courier", "张三", "张三")).toBe(true);
    expect(canPushDelivery("courier", "李四", "张三")).toBe(false);
    expect(canPushDelivery("courier", "", "张三")).toBe(false);
    expect(canPushDelivery("courier", "张三", null)).toBe(false);
  });

  it("customer 只读，恒不可推进", () => {
    expect(canPushDelivery("customer", "", "张三")).toBe(false);
    expect(canPushDelivery("customer", "张三", "张三")).toBe(false);
  });
});
