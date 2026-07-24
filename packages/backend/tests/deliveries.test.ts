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

// 建配送单辅助：先建订单再创配送单
async function createDelivery(): Promise<{ id: number; orderId: number }> {
  const order = await createOrder();
  const res = await request(app).post("/api/deliveries").send({ orderId: order.id });
  return res.body;
}

describe("GET /api/deliveries（列表 / 按配送员过滤）", () => {
  it("无过滤：返回全部配送单", async () => {
    await createDelivery();
    await createDelivery();
    const res = await request(app).get("/api/deliveries");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it("按 deliveryPerson 过滤：仅返回该配送员的单", async () => {
    const a = await createDelivery();
    const b = await createDelivery();
    await request(app).patch(`/api/deliveries/${a.id}/assign`).send({ deliveryPerson: "张三" });
    await request(app).patch(`/api/deliveries/${b.id}/assign`).send({ deliveryPerson: "李四" });

    const res = await request(app).get("/api/deliveries?deliveryPerson=张三");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(a.id);
    expect(res.body[0].deliveryPerson).toBe("张三");
  });

  it("过滤无匹配：返回空数组", async () => {
    await createDelivery();
    const res = await request(app).get("/api/deliveries?deliveryPerson=不存在的人");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("未分配单（deliveryPerson=null）不出现在按人过滤结果中", async () => {
    await createDelivery(); // 未分配
    const res = await request(app).get("/api/deliveries?deliveryPerson=张三");
    expect(res.body).toHaveLength(0);
  });
});

describe("PATCH /api/deliveries/:id/assign（分配配送员）", () => {
  it("正常分配：200，deliveryPerson 落库并可查询回显", async () => {
    const d = await createDelivery();
    const res = await request(app)
      .patch(`/api/deliveries/${d.id}/assign`)
      .send({ deliveryPerson: "张三" });
    expect(res.status).toBe(200);
    expect(res.body.deliveryPerson).toBe("张三");

    const got = await request(app).get(`/api/deliveries/${d.id}`);
    expect(got.body.deliveryPerson).toBe("张三");
  });

  it("姓名首尾空白被 trim", async () => {
    const d = await createDelivery();
    const res = await request(app)
      .patch(`/api/deliveries/${d.id}/assign`)
      .send({ deliveryPerson: "  张三  " });
    expect(res.body.deliveryPerson).toBe("张三");
  });

  it("空姓名 / 缺字段 -> 400", async () => {
    const d = await createDelivery();
    const empty = await request(app)
      .patch(`/api/deliveries/${d.id}/assign`)
      .send({ deliveryPerson: "   " });
    expect(empty.status).toBe(400);
    const missing = await request(app).patch(`/api/deliveries/${d.id}/assign`).send({});
    expect(missing.status).toBe(400);
  });

  it("配送单不存在 -> 404", async () => {
    const res = await request(app)
      .patch("/api/deliveries/999999/assign")
      .send({ deliveryPerson: "张三" });
    expect(res.status).toBe(404);
  });

  it("已送达的配送单不可再分配 -> 400", async () => {
    const d = await createDelivery();
    // 推进到终态 delivered：pending->picked_up->in_transit->delivered
    for (const s of ["picked_up", "in_transit", "delivered"]) {
      await request(app).patch(`/api/deliveries/${d.id}/status`).send({ status: s });
    }
    const res = await request(app)
      .patch(`/api/deliveries/${d.id}/assign`)
      .send({ deliveryPerson: "张三" });
    expect(res.status).toBe(400);
  });
});
