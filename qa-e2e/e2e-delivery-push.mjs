// 配送状态推进功能 — 多角色 E2E（Playwright headless）
// 覆盖 E1-E7 + 状态机边界/异常 + assign 校验 + 5xx 不乐观更新 + 刷新角色持久化。
//
// 依赖（feat/delivery-status-push 分支代码合入后）：
//   后端：PATCH /api/deliveries/:id/assign、GET /api/deliveries?deliveryPerson=
//   前端：RoleSwitcher + /deliveries(DeliveryTaskPage) + 各页 data-testid（见 SELECTORS）
//
// 约定：data-testid 选择器由 QA 定稿（第3幕），Dev 按此嵌入。若命名变更，同步改 SELECTORS。
//
// 运行：
//   cd packages/backend && DATABASE_URL=file:./dev.db PORT=3001 npx tsx src/index.ts &
//   cd packages/frontend && npx vite --port 5173 --host 127.0.0.1 &
//   node qa-e2e/e2e-delivery-push.mjs
// 退出码 0=全绿，非 0=有用例失败。

import { chromium } from "playwright";

const CHROME = process.env.CHROME_PATH;
const IGNORE_CERT = process.env.E2E_IGNORE_CERT === "1";
const launchOpts = {
  ...(CHROME ? { executablePath: CHROME } : {}),
  ...(IGNORE_CERT ? { args: ["--ignore-certificate-errors"] } : {}),
};
const CTX_BASE = IGNORE_CERT ? { ignoreHTTPSErrors: true } : {};
const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";

// ---- data-testid 契约（QA 定稿） ----
const T = {
  roleSwitcher: "[data-testid=role-switcher]",
  roleAdmin: "[data-testid=role-admin]",
  roleCourier: "[data-testid=role-courier]",
  roleCustomer: "[data-testid=role-customer]",
  personInput: "[data-testid=delivery-person-input]", // courier 模式姓名输入（写 ?person=）
  deliveryStatus: "[data-testid=delivery-status]",
  pushBtn: "[data-testid=delivery-push-btn]",
  assignInput: "[data-testid=delivery-assign-input]",
  assignSubmit: "[data-testid=delivery-assign-submit]",
  taskItem: "[data-testid=delivery-task-item]",
  timeline: "[data-testid=delivery-timeline]",
};

const FLOW = ["pending", "picked_up", "in_transit", "delivered"];
// 状态文案映射（前端按 DELIVERY_FLOW 渲染中文；若 Dev 用枚举值文本，改此处）
const LABEL = {
  pending: "待取货",
  picked_up: "已取货",
  in_transit: "配送中",
  delivered: "已送达",
};

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✅ ${name} ${extra}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

// ---- API seed（数据独立：每用例自建 order+delivery，不依赖其他用例） ----
async function api(path, init) {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

// 建订单 + 配送单（pending 起步），返回 { orderId, deliveryId }
async function seedOrderDelivery(mark) {
  const customerName = `QA-${mark}`;
  const ord = await api("/orders", {
    method: "POST",
    body: JSON.stringify({
      items: [{ menuItemId: 1, quantity: 1 }],
      customerName,
      customerPhone: "13800000000",
      customerAddress: `QA地址-${mark}`,
    }),
  });
  if (!ord.ok) throw new Error(`seed order 失败: ${ord.status} ${JSON.stringify(ord.body)}`);
  const orderId = ord.body.id;
  const del = await api("/deliveries", {
    method: "POST",
    body: JSON.stringify({ orderId }),
  });
  if (!del.ok) throw new Error(`seed delivery 失败: ${del.status} ${JSON.stringify(del.body)}`);
  return { orderId, deliveryId: del.body.id };
}

const browser = await chromium.launch(launchOpts);

// ============ E1 管理员：OrderListPage 推进全流程 ============
console.log("E1 管理员 OrderListPage 推进 pending→delivered");
{
  const ctx = await browser.newContext(CTX_BASE);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const { deliveryId } = await seedOrderDelivery("E1");
  await page.goto(`${BASE}/orders?role=admin`);
  await page.waitForSelector(T.deliveryStatus);
  // 推进 3 次：pending→picked_up→in_transit→delivered
  for (let i = 1; i < FLOW.length; i++) {
    const before = await page.locator(T.deliveryStatus).first().textContent();
    await page.locator(T.pushBtn).first().click();
    await page.waitForFunction(
      (exp) => document.querySelector("[data-testid=delivery-status]")?.textContent === exp,
      LABEL[FLOW[i]],
    );
    const after = await page.locator(T.deliveryStatus).first().textContent();
    check(`E1 推进 ${FLOW[i - 1]}→${FLOW[i]}`, after === LABEL[FLOW[i]], `(before=${before} after=${after})`);
  }
  const disabled = await page.locator(T.pushBtn).first().isDisabled().catch(() => true);
  check("E1 delivered 后 push-btn disabled", disabled === true);
  await ctx.close();
}

// ============ E2 管理员：OrderDetailPage 配送区推进（入口冗余） ============
console.log("E2 管理员 OrderDetailPage 推进");
{
  const ctx = await browser.newContext(CTX_BASE);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const { orderId, deliveryId } = await seedOrderDelivery("E2");
  await page.goto(`${BASE}/orders/${orderId}?role=admin`);
  await page.waitForSelector(T.pushBtn);
  await page.locator(T.pushBtn).click();
  await page.waitForSelector(`${T.deliveryStatus} >> text=${LABEL.picked_up}`);
  const status = await page.locator(T.deliveryStatus).first().textContent();
  check("E2 OrderDetailPage 推进 pending→picked_up", status === LABEL.picked_up, `(status=${status})`);
  await ctx.close();
}

// ============ E3 管理员：分配配送员 ============
console.log("E3 管理员 分配配送员");
{
  const ctx = await browser.newContext(CTX_BASE);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const { orderId } = await seedOrderDelivery("E3");
  await page.goto(`${BASE}/orders/${orderId}?role=admin`);
  await page.waitForSelector(T.assignInput);
  await page.locator(T.assignInput).fill("张三");
  await page.locator(T.assignSubmit).click();
  await page.waitForTimeout(300);
  const person = await page.locator("[data-testid=delivery-person]").first().textContent().catch(() => "");
  check("E3 分配后回显 deliveryPerson=张三", /张三/.test(person ?? ""), `(person=${person})`);
  await ctx.close();
}

// ============ E4 配送员：只见分配给自己的单 ============
console.log("E4 配送员 DeliveryTaskPage 只见己方单");
{
  const ctx = await browser.newContext(CTX_BASE);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const mine = await seedOrderDelivery("E4-mine");
  const other = await seedOrderDelivery("E4-other");
  // mine 分配给张三，other 分配给李四
  await api(`/deliveries/${mine.deliveryId}/assign`, {
    method: "PATCH", body: JSON.stringify({ deliveryPerson: "张三" }),
  });
  await api(`/deliveries/${other.deliveryId}/assign`, {
    method: "PATCH", body: JSON.stringify({ deliveryPerson: "李四" }),
  });
  await page.goto(`${BASE}/deliveries?role=courier&person=张三`);
  await page.waitForSelector(T.taskItem);
  const items = await page.locator(T.taskItem).allInnerTexts();
  const allMine = items.every((t) => /QA-E4-mine/.test(t));
  const noOther = items.every((t) => !/QA-E4-other/.test(t));
  check("E4 只见己方单(张三)", allMine && noOther, `(items=${items.length})`);
  await ctx.close();
}

// ============ E5 配送员：推进己方单 + 隔离 ============
console.log("E5 配送员 推进己方单 + 隔离");
{
  const ctx = await browser.newContext(CTX_BASE);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const mine = await seedOrderDelivery("E5");
  await api(`/deliveries/${mine.deliveryId}/assign`, {
    method: "PATCH", body: JSON.stringify({ deliveryPerson: "张三" }),
  });
  await page.goto(`${BASE}/deliveries?role=courier&person=张三`);
  await page.waitForSelector(T.taskItem);
  await page.locator(T.pushBtn).first().click();
  await page.waitForFunction(
    () => document.querySelector("[data-testid=delivery-status]")?.textContent === "已取货",
  );
  const status = await page.locator(T.deliveryStatus).first().textContent();
  check("E5 配送员推进己方单 pending→picked_up", status === "已取货", `(status=${status})`);
  // 切换 person=李四 后原单不可见
  await page.goto(`${BASE}/deliveries?role=courier&person=李四`);
  await page.waitForTimeout(500);
  const count = await page.locator(T.taskItem).count();
  check("E5 切 person=李四 后原单不可见(隔离)", count === 0, `(count=${count})`);
  await ctx.close();
}

// ============ E6 顾客：只读追踪，无推进入口 ============
console.log("E6 顾客 只读追踪");
{
  const ctx = await browser.newContext(CTX_BASE);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const { deliveryId } = await seedOrderDelivery("E6");
  await page.goto(`${BASE}/delivery/${deliveryId}?role=customer`);
  await page.waitForSelector(T.timeline);
  const pushCount = await page.locator(T.pushBtn).count();
  check("E6 顾客视角 无 push-btn", pushCount === 0, `(pushBtn=${pushCount})`);
  const timeline = await page.locator(T.timeline).count();
  check("E6 顾客视角 时间线渲染", timeline > 0, `(timeline=${timeline})`);
  await ctx.close();
}

// ============ E7 跨角色：RoleSwitcher 切换后渲染随之变 ============
console.log("E7 跨角色 RoleSwitcher 切换");
{
  const ctx = await browser.newContext(CTX_BASE);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const { deliveryId } = await seedOrderDelivery("E7");
  await page.goto(`${BASE}/delivery/${deliveryId}?role=admin`);
  await page.waitForSelector(T.pushBtn);
  check("E7 admin 视角 push-btn 可见", (await page.locator(T.pushBtn).count()) > 0);
  await page.locator(T.roleCustomer).click();
  await page.waitForTimeout(300);
  check("E7 切 customer 后 push-btn 消失", (await page.locator(T.pushBtn).count()) === 0);
  await page.locator(T.roleAdmin).click();
  await page.waitForTimeout(300);
  check("E7 切回 admin 后 push-btn 复现", (await page.locator(T.pushBtn).count()) > 0);
  await ctx.close();
}

// ============ B1 状态机边界：跳变/回退/delivered 后再推（API 层） ============
console.log("B1 状态机边界 (API)");
{
  const { deliveryId } = await seedOrderDelivery("B1");
  // 跳变 pending→delivered
  const jump = await api(`/deliveries/${deliveryId}/status`, {
    method: "PATCH", body: JSON.stringify({ status: "delivered" }),
  });
  check("B1 跳变 pending→delivered 拒绝(400)", jump.status === 400, `(status=${jump.status})`);
  // 正常推进到 in_transit
  await api(`/deliveries/${deliveryId}/status`, { method: "PATCH", body: JSON.stringify({ status: "picked_up" }) });
  await api(`/deliveries/${deliveryId}/status`, { method: "PATCH", body: JSON.stringify({ status: "in_transit" }) });
  // 回退 in_transit→picked_up
  const back = await api(`/deliveries/${deliveryId}/status`, {
    method: "PATCH", body: JSON.stringify({ status: "picked_up" }),
  });
  check("B1 回退 in_transit→picked_up 拒绝(400)", back.status === 400, `(status=${back.status})`);
  // 推到 delivered 后再推
  await api(`/deliveries/${deliveryId}/status`, { method: "PATCH", body: JSON.stringify({ status: "delivered" }) });
  const afterDone = await api(`/deliveries/${deliveryId}/status`, {
    method: "PATCH", body: JSON.stringify({ status: "picked_up" }),
  });
  check("B1 delivered 后再推 拒绝(400)", afterDone.status === 400, `(status=${afterDone.status})`);
}

// ============ B2 assign 校验（API 层） ============
console.log("B2 assign 校验 (API)");
{
  const { deliveryId } = await seedOrderDelivery("B2");
  const empty = await api(`/deliveries/${deliveryId}/assign`, {
    method: "PATCH", body: JSON.stringify({ deliveryPerson: "   " }),
  });
  check("B2 assign 空姓名 拒绝(400)", empty.status === 400, `(status=${empty.status})`);
  const notExist = await api(`/deliveries/999999/assign`, {
    method: "PATCH", body: JSON.stringify({ deliveryPerson: "张三" }),
  });
  check("B2 assign 不存在 id 拒绝(404)", notExist.status === 404, `(status=${notExist.status})`);
  // delivered 单拒绝再分配
  const { deliveryId: d2 } = await seedOrderDelivery("B2-done");
  for (const s of ["picked_up", "in_transit", "delivered"]) {
    await api(`/deliveries/${d2}/status`, { method: "PATCH", body: JSON.stringify({ status: s }) });
  }
  const afterDelivered = await api(`/deliveries/${d2}/assign`, {
    method: "PATCH", body: JSON.stringify({ deliveryPerson: "张三" }),
  });
  check("B2 assign 已delivered 拒绝(400)", afterDelivered.status === 400, `(status=${afterDelivered.status})`);
}

// ============ B3 5xx 不乐观更新：推进失败 UI 不残留错误状态 ============
console.log("B3 5xx 不乐观更新");
{
  const ctx = await browser.newContext(CTX_BASE);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const { deliveryId } = await seedOrderDelivery("B3");
  await page.goto(`${BASE}/delivery/${deliveryId}?role=admin`);
  await page.waitForSelector(T.pushBtn);
  const before = await page.locator(T.deliveryStatus).first().textContent();
  // 拦截 PATCH status 返回 500
  await page.route("**/api/deliveries/*/status", (route) =>
    route.fulfill({ status: 500, body: JSON.stringify({ error: "mock 500" }) }),
  );
  await page.locator(T.pushBtn).click();
  await page.waitForTimeout(600);
  const after = await page.locator(T.deliveryStatus).first().textContent();
  check("B3 5xx 后状态不被乐观更新", after === before, `(before=${before} after=${after})`);
  await ctx.close();
}

// ============ B4 刷新角色持久化（URL 即状态） ============
console.log("B4 刷新角色持久化");
{
  const ctx = await browser.newContext(CTX_BASE);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const { deliveryId } = await seedOrderDelivery("B4");
  await page.goto(`${BASE}/deliveries?role=courier&person=张三`);
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForTimeout(300);
  const url = page.url();
  const roleKept = /[?&]role=courier/.test(url) && /[?&]person=张三/.test(url);
  check("B4 刷新后 role/person 保留(URL)", roleKept, `(url=${url})`);
  await ctx.close();
}

await browser.close();
console.log(`\n=== E2E 配送推进 结果: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
