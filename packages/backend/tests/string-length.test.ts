import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { customer, resetDb, seedMenu } from "./helpers";

// 引擎语义差异回归（A4 §二.1，PG 裁定）：
// MySQL 非 strict 模式下 String 超长会**静默截断**（varchar(191) 陷阱的根源）；
// PG 严格模式超长直接抛 `value too long for type character varying(n)`——**永不静默截断**。
// 本套件钉死"非静默截断"不变式：VarChar 超长输入不会被悄悄截成 n 后存库返回 201。
// 状态码不钉死（现状 500，C1 补 assertMaxLen helper 后翻 400）——只钉"不静默截断"，
// 故 500→400 翻码本套件无需同步改（与 C1 VarChar 校验补丁解耦）。
// schema 所有 String 字段均带显式 @db.VarChar(n)/@db.Text，无字段依赖默认 varchar(191)，
// 故 MySQL 默认陷阱对当前 schema 本就不触发；本测试守的是"显式长度边界也不静默截断"。
const app = createApp();

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("PG 不静默截断 VarChar 超长输入", () => {
  it("customerAddress VarChar(255) 超长：不静默截断成 255 后存库返回 201", async () => {
    const { latte } = await seedMenu();
    const longAddress = "x".repeat(300); // 超 customerAddress VarChar(255)
    const res = await request(app)
      .post("/api/orders")
      .send({
        items: [{ menuItemId: latte.id, quantity: 1 }],
        customerName: "QA长地址",
        customerPhone: "13800000000",
        customerAddress: longAddress,
      });
    // 核心不变式：绝不"201 + 静默截断成 255"。PG 抛 value too long → 现状 500；
    // C1 补 assertMaxLen 后 → 400。两者都 not 201，本断言 500/400 均通过。
    expect(res.status).not.toBe(201);
    // 防御性：若将来某路径改成持久化超长（如 schema 放宽），落库值必须完整不截断。
    if (res.status === 201) {
      const stored = await prisma.order.findUnique({
        where: { id: res.body.id },
        select: { customerAddress: true },
      });
      expect(stored?.customerAddress.length).toBe(300);
    }
  });

  it("customerName VarChar(100) 超长：不静默截断", async () => {
    const { latte } = await seedMenu();
    const longName = "张".repeat(101); // 超 customerName VarChar(100)
    const res = await request(app)
      .post("/api/orders")
      .send({
        items: [{ menuItemId: latte.id, quantity: 1 }],
        customerName: longName,
        customerPhone: "13800000000",
        customerAddress: "QA地址",
      });
    expect(res.status).not.toBe(201);
  });

  it("边界值：255 字符地址正好落库完整（边界不误伤）", async () => {
    const { latte } = await seedMenu();
    const edgeAddress = "y".repeat(255); // 正好 VarChar(255) 上界
    const res = await request(app)
      .post("/api/orders")
      .send({
        items: [{ menuItemId: latte.id, quantity: 1 }],
        ...customer,
        customerAddress: edgeAddress,
      });
    expect(res.status).toBe(201);
    const stored = await prisma.order.findUnique({
      where: { id: res.body.id },
      select: { customerAddress: true },
    });
    expect(stored?.customerAddress).toBe(edgeAddress);
    expect(stored?.customerAddress.length).toBe(255);
  });
});
