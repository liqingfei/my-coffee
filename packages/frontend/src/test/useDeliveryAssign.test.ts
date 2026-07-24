import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { useDeliveryAssign } from "../hooks/useDeliveryAssign";

vi.mock("../api", () => ({ api: { assignDeliveryPerson: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("useDeliveryAssign", () => {
  it("空姓名（含纯空白）：不发请求、不触发 onChanged", async () => {
    const onChanged = vi.fn();
    const { result } = renderHook(() => useDeliveryAssign(onChanged));
    await result.current.assign(9, "   ");
    expect(api.assignDeliveryPerson).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("成功：trim 后调 api.assignDeliveryPerson 并触发 onChanged", async () => {
    vi.mocked(api.assignDeliveryPerson).mockResolvedValue({} as never);
    const onChanged = vi.fn();
    const { result } = renderHook(() => useDeliveryAssign(onChanged));

    await result.current.assign(9, "  张三  ");

    expect(api.assignDeliveryPerson).toHaveBeenCalledWith(9, "张三");
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe("");
  });

  it("失败：记录后端错误文案，不触发 onChanged", async () => {
    vi.mocked(api.assignDeliveryPerson).mockRejectedValue(
      new Error("已送达的配送单不可再分配"),
    );
    const onChanged = vi.fn();
    const { result } = renderHook(() => useDeliveryAssign(onChanged));

    await result.current.assign(9, "张三");

    await waitFor(() =>
      expect(result.current.error).toBe("已送达的配送单不可再分配"),
    );
    expect(onChanged).not.toHaveBeenCalled();
  });
});
