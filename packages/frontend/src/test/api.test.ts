import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";

// 通过桩化全局 fetch 验证 api 封装：URL 拼装、method/body、非 2xx 抛错文案
function jsonResponse(data: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => data } as unknown as Response;
}

function stubFetch(res: Response) {
  const fetchMock = vi.fn().mockResolvedValue(res);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("api.listOrders", () => {
  it("无 status：请求 /api/orders 并带 JSON 头", async () => {
    const data = [{ id: 1 }, { id: 2 }];
    const fetchMock = stubFetch(jsonResponse(data));

    await expect(api.listOrders()).resolves.toEqual(data);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/orders");
    expect((init as RequestInit).headers).toMatchObject({
      "Content-Type": "application/json",
    });
  });

  it("带 status：拼 ?status= 并 URL 编码", async () => {
    const fetchMock = stubFetch(jsonResponse([]));
    await api.listOrders("in transit");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/orders?status=in%20transit");
  });
});

describe("api 其余方法与错误处理", () => {
  it("getMenu 带/不带 category", async () => {
    const fetchMock = stubFetch(jsonResponse([]));
    await api.getMenu("咖啡");
    await api.getMenu();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/menu?category=%E5%92%96%E5%95%A1",
    );
    expect(fetchMock.mock.calls[1][0]).toBe("/api/menu");
  });

  it("createOrder：POST /api/orders 带序列化 body", async () => {
    const fetchMock = stubFetch(jsonResponse({ id: 1 }, true, 201));
    const payload = {
      items: [{ menuItemId: 1, quantity: 2 }],
      customerName: "a",
      customerPhone: "b",
      customerAddress: "c",
    };
    await api.createOrder(payload);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/orders");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBe(JSON.stringify(payload));
  });

  it("getOrder / createDelivery / getDelivery 的 URL 与 method", async () => {
    const fetchMock = stubFetch(jsonResponse({}));
    await api.getOrder(5);
    await api.createDelivery(7);
    await api.getDelivery(9);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/orders/5");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/deliveries");
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe("POST");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/deliveries/9");
  });

  it("非 2xx：抛 Error 且携带后端 error 文案", async () => {
    stubFetch(jsonResponse({ error: "库存不足" }, false, 400));
    await expect(api.listOrders()).rejects.toThrow("库存不足");
  });

  it("非 2xx 且 body 无 error：回退到状态码文案", async () => {
    stubFetch(jsonResponse(null, false, 500));
    await expect(api.getOrder(1)).rejects.toThrow("请求失败(500)");
  });
});
