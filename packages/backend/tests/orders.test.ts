import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { customer, resetDb, seedMenu } from "./helpers";

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /api/orders", () => {
  it("正常下单：201，totalPrice 由服务端重算，items 含价格快照", async () => {
    const { americana, latte } = await seedMenu();
    const res = await request(app)
      .post("/api/orders")
      .send({
        items: [
          { menuItemId: americana.id, quantity: 2 }, // 18*2=36
          { menuItemId: latte.id, quantity: 1 }, // 24
        ],
        ...customer,
      });
    expect(res.status).toBe(201);
    expect(res.body.totalPrice).toBe(60);
    expect(res.body.status).toBe("pending");
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toMatchObject({
      menuItemId: americana.id,
      name: "美式咖啡",
      quantity: 2,
      price: 18,
      subtotal: 36,
    });
  });

  it("忽略客户端传入的 price/totalPrice（防篡改）", async () => {
    const { americana } = await seedMenu();
    const res = await request(app)
      .post("/api/orders")
      .send({
        items: [{ menuItemId: americana.id, quantity: 1, price: 0.01, subtotal: 0.01 }],
        totalPrice: 0.01,
        ...customer,
      });
    expect(res.status).toBe(201);
    expect(res.body.totalPrice).toBe(18); // 以 DB 单价为准
    expect(res.body.items[0].price).toBe(18);
  });

  it("空购物车 -> 400", async () => {
    await seedMenu();
    const res = await request(app)
      .post("/api/orders")
      .send({ items: [], ...customer });
    expect(res.status).toBe(400);
  });

  it("缺少必填顾客字段 -> 400", async () => {
    const { americana } = await seedMenu();
    const res = await request(app)
      .post("/api/orders")
      .send({ items: [{ menuItemId: americana.id, quantity: 1 }], customerName: "张三" });
    expect(res.status).toBe(400);
  });

  it("不存在的 menuItemId -> 400", async () => {
    await seedMenu();
    const res = await request(app)
      .post("/api/orders")
      .send({ items: [{ menuItemId: 999999, quantity: 1 }], ...customer });
    expect(res.status).toBe(400);
  });

  it("已下架商品 -> 400", async () => {
    const { offShelf } = await seedMenu();
    const res = await request(app)
      .post("/api/orders")
      .send({ items: [{ menuItemId: offShelf.id, quantity: 1 }], ...customer });
    expect(res.status).toBe(400);
  });

  it("quantity < 1 -> 400", async () => {
    const { americana } = await seedMenu();
    const res = await request(app)
      .post("/api/orders")
      .send({ items: [{ menuItemId: americana.id, quantity: 0 }], ...customer });
    expect(res.status).toBe(400);
  });

  it("非法 JSON 请求体 -> 400（非 500）", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set("Content-Type", "application/json")
      .send('{"items": ['); // 截断的非法 JSON
    expect(res.status).toBe(400);
  });
});

// 顾客字段长度上限校验（CR 945yc7s7 裁决）：create 入口经 assertMaxLen 前置校验，
// 超长翻译为 400（PG 抛 `value too long` 会落到 500 通道，状态码错误）。
// 「非静默截断」引擎不变式由 string-length.test.ts 钉死（not 201，不钉状态码），
// 本套件钉的是状态码契约：400 + 错误信息含字段名与上限。
describe("顾客字段超长 -> 400（assertMaxLen 前置校验）", () => {
  it("customerName 超 100 -> 400，错误信息含字段名与上限", async () => {
    const { americana } = await seedMenu();
    const res = await request(app)
      .post("/api/orders")
      .send({
        items: [{ menuItemId: americana.id, quantity: 1 }],
        ...customer,
        customerName: "名".repeat(101),
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("customerName");
    expect(res.body.error).toContain("100");
  });

  it("customerPhone 超 32 -> 400", async () => {
    const { americana } = await seedMenu();
    const res = await request(app)
      .post("/api/orders")
      .send({
        items: [{ menuItemId: americana.id, quantity: 1 }],
        ...customer,
        customerPhone: "1".repeat(33),
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("customerPhone");
  });

  it("customerAddress 超 255 -> 400（非 500）", async () => {
    const { americana } = await seedMenu();
    const res = await request(app)
      .post("/api/orders")
      .send({
        items: [{ menuItemId: americana.id, quantity: 1 }],
        ...customer,
        customerAddress: "址".repeat(256),
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("customerAddress");
    expect(res.body.error).toContain("255");
  });

  it("三字段恰好上限（100/32/255）-> 201，边界不误伤", async () => {
    const { americana } = await seedMenu();
    const res = await request(app)
      .post("/api/orders")
      .send({
        items: [{ menuItemId: americana.id, quantity: 1 }],
        customerName: "名".repeat(100),
        customerPhone: "1".repeat(32),
        customerAddress: "址".repeat(255),
      });
    expect(res.status).toBe(201);
  });
});

describe("GET /api/orders 与 /api/orders/:id", () => {
  async function createOneOrder() {
    const { americana } = await seedMenu();
    const res = await request(app)
      .post("/api/orders")
      .send({ items: [{ menuItemId: americana.id, quantity: 1 }], ...customer });
    return res.body;
  }

  it("列表正常返回数组", async () => {
    await createOneOrder();
    const res = await request(app).get("/api/orders");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("?status 过滤", async () => {
    await createOneOrder();
    const pending = await request(app).get("/api/orders?status=pending");
    const completed = await request(app).get("/api/orders?status=completed");
    expect(pending.body).toHaveLength(1);
    expect(completed.body).toHaveLength(0);
  });

  it("订单详情内嵌 delivery（初始为 null）", async () => {
    const order = await createOneOrder();
    const res = await request(app).get(`/api/orders/${order.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(order.id);
    expect(res.body.delivery).toBeNull();
  });

  it("不存在的订单 -> 404", async () => {
    const res = await request(app).get("/api/orders/999999");
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/orders/:id/status（状态机）", () => {
  it("合法流转 pending -> confirmed -> 200", async () => {
    const { americana } = await seedMenu();
    const created = await request(app)
      .post("/api/orders")
      .send({ items: [{ menuItemId: americana.id, quantity: 1 }], ...customer });
    const res = await request(app)
      .patch(`/api/orders/${created.body.id}/status`)
      .send({ status: "confirmed" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("confirmed");
  });

  it("非法跳变 pending -> completed -> 400", async () => {
    const { americana } = await seedMenu();
    const created = await request(app)
      .post("/api/orders")
      .send({ items: [{ menuItemId: americana.id, quantity: 1 }], ...customer });
    const res = await request(app)
      .patch(`/api/orders/${created.body.id}/status`)
      .send({ status: "completed" });
    expect(res.status).toBe(400);
  });

  it("缺少 body.status -> 400", async () => {
    const { americana } = await seedMenu();
    const created = await request(app)
      .post("/api/orders")
      .send({ items: [{ menuItemId: americana.id, quantity: 1 }], ...customer });
    const res = await request(app).patch(`/api/orders/${created.body.id}/status`).send({});
    expect(res.status).toBe(400);
  });

  it("不存在的订单 -> 404", async () => {
    const res = await request(app)
      .patch("/api/orders/999999/status")
      .send({ status: "confirmed" });
    expect(res.status).toBe(404);
  });
});
