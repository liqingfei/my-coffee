import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { customer, resetDb, seedMenu } from "./helpers";

// 线协议金额契约：所有金额字段序列化为 JSON number（非 string）。
// PG Decimal 下 Prisma 默认返回 Decimal、JSON.stringify 得 string——
// 任一读边界落点漏转，前端 toFixed 即崩。本测试按 A2 §2 / A4 契约矩阵
// 逐点断言 typeof === "number"：menu.price、order.totalPrice、items[].price/
// items[].subtotal、delivery.fee、订单内嵌 delivery.fee。
const app = createApp();

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("线协议金额 typeof 契约", () => {
  it("GET /api/menu：price 为 number", async () => {
    await seedMenu();
    const res = await request(app).get("/api/menu");
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const item of res.body) {
      expect(typeof item.price).toBe("number");
    }
  });

  it("POST /api/orders：totalPrice 与 items[].price/subtotal 为 number", async () => {
    const { latte } = await seedMenu();
    const res = await request(app)
      .post("/api/orders")
      .send({ items: [{ menuItemId: latte.id, quantity: 2 }], ...customer });
    expect(res.status).toBe(201);
    expect(typeof res.body.totalPrice).toBe("number");
    expect(res.body.totalPrice).toBe(48);
    expect(res.body.items.length).toBe(1);
    for (const item of res.body.items) {
      expect(typeof item.price).toBe("number");
      expect(typeof item.subtotal).toBe("number");
    }
  });

  it("GET /api/orders/:id：嵌套 delivery.fee 为 number（CR 🔴 第 5 落点）", async () => {
    const { americana } = await seedMenu();
    const order = await request(app)
      .post("/api/orders")
      .send({ items: [{ menuItemId: americana.id, quantity: 1 }], ...customer });
    await request(app)
      .post("/api/deliveries")
      .send({ orderId: order.body.id });
    const detail = await request(app).get(`/api/orders/${order.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.delivery).not.toBeNull();
    expect(typeof detail.body.delivery.fee).toBe("number");
    expect(detail.body.delivery.fee).toBe(5);
  });

  it("GET /api/orders 列表：totalPrice 与嵌套 delivery.fee 为 number", async () => {
    const { tea } = await seedMenu();
    const order = await request(app)
      .post("/api/orders")
      .send({ items: [{ menuItemId: tea.id, quantity: 3 }], ...customer });
    await request(app)
      .post("/api/deliveries")
      .send({ orderId: order.body.id });
    const list = await request(app).get("/api/orders");
    expect(list.status).toBe(200);
    const row = list.body.find((o: { id: number }) => o.id === order.body.id);
    expect(typeof row.totalPrice).toBe("number");
    expect(typeof row.delivery.fee).toBe("number");
  });

  it("POST/GET /api/deliveries：fee 为 number", async () => {
    const { latte } = await seedMenu();
    const order = await request(app)
      .post("/api/orders")
      .send({ items: [{ menuItemId: latte.id, quantity: 1 }], ...customer });
    const created = await request(app)
      .post("/api/deliveries")
      .send({ orderId: order.body.id });
    expect(created.status).toBe(201);
    expect(typeof created.body.fee).toBe("number");
    const got = await request(app).get(`/api/deliveries/${created.body.id}`);
    expect(got.status).toBe(200);
    expect(typeof got.body.fee).toBe("number");
  });
});
