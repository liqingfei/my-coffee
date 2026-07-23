import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { useCreateDelivery } from "../hooks/useCreateDelivery";

vi.mock("../api", () => ({ api: { createDelivery: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useCreateDelivery", () => {
  it("取消二次确认：不调用 api，也不触发 onCreated", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const onCreated = vi.fn();
    const { result } = renderHook(() => useCreateDelivery(onCreated));

    await result.current.createDelivery(1);

    expect(api.createDelivery).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("确认后成功：调用 api.createDelivery(id) 并触发 onCreated", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.createDelivery).mockResolvedValue({} as never);
    const onCreated = vi.fn();
    const { result } = renderHook(() => useCreateDelivery(onCreated));

    await result.current.createDelivery(3);

    expect(api.createDelivery).toHaveBeenCalledWith(3);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(result.current.creating).toBe(false);
    expect(result.current.error).toBe("");
  });

  it("创建失败：error 记录后端文案，不触发 onCreated", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.createDelivery).mockRejectedValue(new Error("boom"));
    const onCreated = vi.fn();
    const { result } = renderHook(() => useCreateDelivery(onCreated));

    await result.current.createDelivery(3);

    await waitFor(() => expect(result.current.error).toBe("boom"));
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("creating 期间的重复调用被忽略（只发一次请求）", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let resolveFn: (v: unknown) => void = () => {};
    vi.mocked(api.createDelivery).mockReturnValue(
      new Promise((r) => {
        resolveFn = r;
      }) as never,
    );
    const onCreated = vi.fn();
    const { result } = renderHook(() => useCreateDelivery(onCreated));

    const first = result.current.createDelivery(1);
    await waitFor(() => expect(result.current.creating).toBe(true));
    await result.current.createDelivery(1); // creating=true，应被忽略

    resolveFn({});
    await first;

    expect(api.createDelivery).toHaveBeenCalledTimes(1);
  });
});
