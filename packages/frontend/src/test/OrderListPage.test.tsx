import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { OrderListPage } from "../pages/OrderListPage";
import type { Order } from "../types";

vi.mock("../api", () => ({
  api: {
    listOrders: vi.fn(),
    createDelivery: vi.fn(),
  },
}));

function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: 1,
    items: [],
    totalPrice: 12.5,
    status: "pending",
    customerName: "张三",
    customerPhone: "13800000000",
    customerAddress: "某地",
    createdAt: "2026-07-23T10:00:00.000Z",
    delivery: null,
    ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <OrderListPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OrderListPage", () => {
  it("加载中显示加载文案", () => {
    vi.mocked(api.listOrders).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText("加载订单中…")).toBeInTheDocument();
  });

  it("渲染订单行：字段、金额 ¥xx.xx、详情链接，且仅无配送单的订单显示创建配送", async () => {
    vi.mocked(api.listOrders).mockResolvedValue([
      makeOrder({ id: 1, customerName: "张三", totalPrice: 12.5, status: "pending" }),
      makeOrder({
        id: 2,
        customerName: "李四",
        totalPrice: 30,
        status: "completed",
        delivery: {
          id: 9,
          orderId: 2,
          status: "delivered",
          fee: 5,
          estimatedTime: null,
          createdAt: "2026-07-23T11:00:00.000Z",
        },
      }),
    ]);
    renderPage();

    expect(await screen.findByText("张三")).toBeInTheDocument();
    expect(screen.getByText("李四")).toBeInTheDocument();
    expect(screen.getByText("#1")).toBeInTheDocument();
    // 金额渲染契约：toFixed(2)，不出现 NaN
    expect(screen.getByText("¥12.50")).toBeInTheDocument();
    expect(screen.getByText("¥30.00")).toBeInTheDocument();
    // 状态标签（chip 与 badge 各一处，共 2 处）
    expect(screen.getAllByText("待确认")).toHaveLength(2);
    expect(screen.getAllByText("已完成")).toHaveLength(2);

    const links = screen.getAllByRole("link", { name: "查看详情" });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/orders/1");

    // 只有 delivery==null 的订单 1 显示创建配送
    expect(screen.getAllByRole("button", { name: "创建配送" })).toHaveLength(1);
  });

  it("无订单显示空态", async () => {
    vi.mocked(api.listOrders).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("暂无订单")).toBeInTheDocument();
  });

  it("加载失败显示错误文案", async () => {
    vi.mocked(api.listOrders).mockRejectedValue(new Error("网络错误"));
    renderPage();
    expect(await screen.findByText("加载失败：网络错误")).toBeInTheDocument();
  });

  it("chip 按状态枚举过滤（点“已完成”只留已完成订单，点“全部”还原）", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listOrders).mockResolvedValue([
      makeOrder({ id: 1, status: "pending", customerName: "张三" }),
      makeOrder({ id: 2, status: "completed", customerName: "李四" }),
    ]);
    renderPage();
    await screen.findByText("张三");

    await user.click(screen.getByRole("button", { name: "已完成" }));
    expect(screen.queryByText("张三")).not.toBeInTheDocument();
    expect(screen.getByText("李四")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "全部" }));
    expect(screen.getByText("张三")).toBeInTheDocument();
  });

  it("创建配送：确认后调用 api 并刷新列表，按钮随配送单出现而消失", async () => {
    const user = userEvent.setup();
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);
    const withDelivery = makeOrder({
      id: 1,
      delivery: {
        id: 9,
        orderId: 1,
        status: "pending",
        fee: 5,
        estimatedTime: null,
        createdAt: "2026-07-23T11:00:00.000Z",
      },
    });
    vi.mocked(api.listOrders)
      .mockResolvedValueOnce([makeOrder({ id: 1 })])
      .mockResolvedValueOnce([withDelivery]);
    vi.mocked(api.createDelivery).mockResolvedValue({} as never);

    renderPage();
    await user.click(await screen.findByRole("button", { name: "创建配送" }));

    expect(confirmMock).toHaveBeenCalledWith("确认创建配送单？配送费 ¥5.00。");
    await waitFor(() => expect(api.createDelivery).toHaveBeenCalledWith(1));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "创建配送" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("取消二次确认则不创建配送", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.mocked(api.listOrders).mockResolvedValue([makeOrder({ id: 1 })]);
    renderPage();

    await user.click(await screen.findByRole("button", { name: "创建配送" }));
    expect(api.createDelivery).not.toHaveBeenCalled();
  });

  it("创建配送失败：显示错误且不清空列表", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.listOrders).mockResolvedValue([makeOrder({ id: 1 })]);
    vi.mocked(api.createDelivery).mockRejectedValue(new Error("配送创建失败"));

    renderPage();
    await user.click(await screen.findByRole("button", { name: "创建配送" }));

    expect(await screen.findByText("配送创建失败")).toBeInTheDocument();
    expect(screen.getByText("#1")).toBeInTheDocument();
  });
});
