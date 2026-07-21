import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { resetDb, seedMenu } from "./helpers";

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /api/menu", () => {
  it("只返回 available=true 的菜单项", async () => {
    await seedMenu();
    const res = await request(app).get("/api/menu");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(3); // 下架项不返回
    expect(res.body.every((i: { available: boolean }) => i.available)).toBe(true);
    expect(res.body.find((i: { name: string }) => i.name === "季节限定")).toBeUndefined();
  });

  it("按分类过滤（?category=咖啡）", async () => {
    await seedMenu();
    const res = await request(app).get("/api/menu?category=咖啡");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.every((i: { category: string }) => i.category === "咖啡")).toBe(true);
  });

  it("空库返回空数组", async () => {
    const res = await request(app).get("/api/menu");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
