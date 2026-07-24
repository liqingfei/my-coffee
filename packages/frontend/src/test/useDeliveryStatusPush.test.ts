import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { useDeliveryStatusPush } from "../hooks/useDeliveryStatusPush";
import type { Delivery } from "../types";

vi.mock("../api", () => ({ api: { updateDeliveryStatus: vi.fn() } }));

function makeDelivery(status: Delivery["status"]): Delivery {
  return {
    id: 9,
    orderId: 1,
    status,
    fee: 5,
    estimatedTime: null,
    deliveryPerson: null,
    createdAt: "2026-07-23T11:00:00.000Z",
  };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("useDeliveryStatusPush", () => {
  it("非终态：算出下一状态调 api，成功后触发 onChanged", async () => {
    vi.mocked(api.updateDeliveryStatus).mockResolvedValue({} as never);
    const onChanged = vi.fn();
    const { result } = renderHook(() => useDeliveryStatusPush(onChanged));

    await result.current.push(makeDelivery("pending"));

    expect(api.updateDeliveryStatus).toHaveBeenCalledWith(9, "picked_up");
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe("");
  });

  it("in_transit 的下一状态是 delivered", async () => {
    vi.mocked(api.updateDeliveryStatus).mockResolvedValue({} as never);
    const { result } = renderHook(() => useDeliveryStatusPush(vi.fn()));
    await result.current.push(makeDelivery("in_transit"));
    expect(api.updateDeliveryStatus).toHaveBeenCalledWith(9, "delivered");
  });

  it("终态 delivered：不发请求、不触发 onChanged", async () => {
    const onChanged = vi.fn();
    const { result } = renderHook(() => useDeliveryStatusPush(onChanged));
    await result.current.push(makeDelivery("delivered"));
    expect(api.updateDeliveryStatus).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("失败：记录后端错误文案，不触发 onChanged（不做乐观更新）", async () => {
    vi.mocked(api.updateDeliveryStatus).mockRejectedValue(
      new Error("非法的配送状态流转"),
    );
    const onChanged = vi.fn();
    const { result } = renderHook(() => useDeliveryStatusPush(onChanged));

    await result.current.push(makeDelivery("pending"));

    await waitFor(() => expect(result.current.error).toBe("非法的配送状态流转"));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("pushing 期间的重复调用被忽略（只发一次请求）", async () => {
    let resolveFn: (v: unknown) => void = () => {};
    vi.mocked(api.updateDeliveryStatus).mockReturnValue(
      new Promise((r) => {
        resolveFn = r;
      }) as never,
    );
    const { result } = renderHook(() => useDeliveryStatusPush(vi.fn()));

    const first = result.current.push(makeDelivery("pending"));
    await waitFor(() => expect(result.current.pushing).toBe(9));
    await result.current.push(makeDelivery("pending")); // pushing 中，应被忽略

    resolveFn({});
    await first;

    expect(api.updateDeliveryStatus).toHaveBeenCalledTimes(1);
  });
});
