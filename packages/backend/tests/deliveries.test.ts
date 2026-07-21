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

async function createOrder(): Promise<{ id: number }> {
  const { americana } = await seedMenu();
  const res = await request(app)
    .post("/api/orders")
    .send({ items: [{ menuItemId: americana.id, quantity: 1 }], ...customer });
  return res.body;
}

describe("POST /api/deliveries", () => {
  it("正常创建：201，fee=5，继承订单顾客信息", async () => {
    const order = await createOrder();
    const res = await request(app).post("/api/deliveries").send({ orderId: order.id });
    expect(res.status).toBe(201);
    expect(res.body.fee).toBe(5);
    expect(res.body.status).toBe("pending");
    expect(res.body.orderId).toBe(order.id);
    expect(res.body.order).toMatchObject({
      id: order.id,
      customerName: customer.customerName,
      customerAddress: customer.customerAddress,
    });
  });

  it("重复为同一订单创建 -> 409", async () => {
    const order = await createOrder();
    await request(app).post("/api/deliveries").send({ orderId: order.id });
    const res = await request(app).post("/api/deliveries").send({ orderId: order.id });
    expect(res.status).toBe(409);
  });

  it("订单不存在 -> 404", async () => {
    const res = await request(app).post("/api/deliveries").send({ orderId: 999999 });
    expect(res.status).toBe(404);
  });

  it("orderId 非法 -> 400", async () => {
    const res = await request(app).post("/api/deliveries").send({ orderId: "abc" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/deliveries/:id", () => {
  it("查询存在的配送单 -> 200", async () => {
    const order = await createOrder();
    const created = await request(app).post("/api/deliveries").send({ orderId: order.id });
    const res = await request(app).get(`/api/deliveries/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
  });

  it("不存在 -> 404", async () => {
    const res = await request(app).get("/api/deliveries/999999");
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/deliveries/:id/status（状态机）", () => {
  it("合法流转 pending -> picked_up -> 200", async () => {
    const order = await createOrder();
    const created = await request(app).post("/api/deliveries").send({ orderId: order.id });
    const res = await request(app)
      .patch(`/api/deliveries/${created.body.id}/status`)
      .send({ status: "picked_up" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("picked_up");
  });

  it("非法跳变 pending -> delivered -> 400", async () => {
    const order = await createOrder();
    const created = await request(app).post("/api/deliveries").send({ orderId: order.id });
    const res = await request(app)
      .patch(`/api/deliveries/${created.body.id}/status`)
      .send({ status: "delivered" });
    expect(res.status).toBe(400);
  });

  it("不存在的配送单 -> 404", async () => {
    const res = await request(app)
      .patch("/api/deliveries/999999/status")
      .send({ status: "picked_up" });
    expect(res.status).toBe(404);
  });
});
