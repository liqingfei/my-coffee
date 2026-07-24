import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { DeliveryTaskPage } from "../pages/DeliveryTaskPage";
import type { Delivery } from "../types";

vi.mock("../api", () => ({
  api: {
    listDeliveries: vi.fn(),
    updateDeliveryStatus: vi.fn(),
  },
}));

function makeDelivery(over: Partial<Delivery> = {}): Delivery {
  return {
    id: 9,
    orderId: 1,
    status: "pending",
    fee: 5,
    estimatedTime: null,
    deliveryPerson: "张三",
    createdAt: "2026-07-23T11:00:00.000Z",
    order: {
      id: 1,
      customerName: "顾客A",
      customerPhone: "138",
      customerAddress: "某地",
      status: "delivering",
    },
    ...over,
  };
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <DeliveryTaskPage />
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("DeliveryTaskPage", () => {
  it("非 courier 角色：引导切换角色，不拉数据", () => {
    renderAt("/deliveries?role=admin");
    expect(screen.getByText(/切换到「配送员」角色/)).toBeInTheDocument();
    expect(api.listDeliveries).not.toHaveBeenCalled();
  });

  it("courier 未填姓名：引导输入姓名，不拉数据", () => {
    renderAt("/deliveries?role=courier");
    expect(screen.getByText(/输入配送员姓名/)).toBeInTheDocument();
    expect(api.listDeliveries).not.toHaveBeenCalled();
  });

  it("courier + 姓名：按 person 过滤拉取并渲染己方任务行（覆盖 QA E4 只见己方）", async () => {
    // 后端按 person 过滤，李四的单不会返回给张三
    vi.mocked(api.listDeliveries).mockResolvedValue([makeDelivery({ id: 9 })]);
    renderAt("/deliveries?role=courier&person=张三");

    expect(await screen.findByTestId("delivery-task-item")).toBeInTheDocument();
    expect(api.listDeliveries).toHaveBeenCalledWith("张三");
    expect(screen.getByTestId("delivery-status")).toHaveTextContent("待取货");
    // 李四的单不可见
    expect(screen.queryByText("李四")).not.toBeInTheDocument();
  });

  it("courier 推进己方单：调 updateDeliveryStatus 并刷新（覆盖 QA E5）", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listDeliveries).mockResolvedValue([makeDelivery({ id: 9 })]);
    vi.mocked(api.updateDeliveryStatus).mockResolvedValue({} as never);
    renderAt("/deliveries?role=courier&person=张三");

    await user.click(await screen.findByTestId("delivery-push-btn"));
    expect(api.updateDeliveryStatus).toHaveBeenCalledWith(9, "picked_up");
    await waitFor(() => expect(api.listDeliveries).toHaveBeenCalledTimes(2));
  });

  it("己方单已送达：不显示推进按钮", async () => {
    vi.mocked(api.listDeliveries).mockResolvedValue([
      makeDelivery({ id: 9, status: "delivered" }),
    ]);
    renderAt("/deliveries?role=courier&person=张三");

    await screen.findByTestId("delivery-task-item");
    expect(screen.queryByTestId("delivery-push-btn")).not.toBeInTheDocument();
  });

  it("无己方任务：显示空态", async () => {
    vi.mocked(api.listDeliveries).mockResolvedValue([]);
    renderAt("/deliveries?role=courier&person=张三");
    expect(await screen.findByText(/暂无分配给 张三 的配送任务/)).toBeInTheDocument();
  });
});
