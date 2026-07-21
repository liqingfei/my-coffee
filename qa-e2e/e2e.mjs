import { chromium } from "playwright";

// 可选：通过 CHROME_PATH 指定 chromium 可执行路径；不设则用 Playwright 自带 chromium。
// 用法示例：CHROME_PATH=/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome node qa-e2e/e2e.mjs
const CHROME = process.env.CHROME_PATH;
const launchOpts = CHROME ? { executablePath: CHROME } : {};
const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✅ ${name} ${extra}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

const browser = await chromium.launch(launchOpts);
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.setDefaultTimeout(15000);

// ---------- E2E-2: 菜单分类筛选 ----------
console.log("E2E-2 菜单分类筛选");
await page.goto(BASE + "/");
await page.waitForSelector("text=咖啡菜单");
const allCards = await page.locator(".card").count();
check("菜单页加载卡片数>0", allCards > 0, `(cards=${allCards})`);
// 点 "咖啡" 分类 chip
await page.locator(".chip", { hasText: "咖啡" }).first().click();
await page.waitForTimeout(300);
const coffeeCards = await page.locator(".card").count();
const allCoffee = (await page.locator(".card .tag").allInnerTexts()).every((t) => t === "咖啡");
check("分类=咖啡 仅显示咖啡项", allCoffee, `(cards=${coffeeCards})`);
// 切回全部
await page.locator(".chip", { hasText: "全部" }).click();
await page.waitForTimeout(300);
check("切回全部 卡片恢复", (await page.locator(".card").count()) === allCards);

// ---------- E2E-5: 异常路径 前端校验 ----------
console.log("E2E-5 异常路径 (前端校验)");
await page.goto(BASE + "/order");
await page.waitForSelector("text=下单");
const submitBtn = page.locator('button[type=submit]');
check("空表单 提交按钮 disabled", await submitBtn.isDisabled());
check("提示文案出现", await page.locator("text=请至少选择 1 件商品").count() > 0);
// 选了商品但表单空 -> 仍 disabled
await page.locator(".card", { hasText: "美式咖啡" }).locator("button").last().click(); // +
check("有商品无信息 提交仍 disabled", await submitBtn.isDisabled());

// ---------- E2E-1: 完整下单→配送 (含 E2E-3 订单详情 + E2E-4 配送追踪) ----------
console.log("E2E-1 完整下单→配送 (含详情/追踪)");
// 美式 + 2 次 (上面已点 1 次，再点 1 次得 qty=2)
await page.locator(".card", { hasText: "美式咖啡" }).locator("button").last().click();
// 填表单
await page.locator('input[placeholder="张三"]').fill("QA用户");
await page.locator('input[placeholder="13800000000"]').fill("13800000000");
await page.locator('input[placeholder="杭州市西湖区文一西路 100 号"]').fill("QA地址");
check("表单填满 提交按钮 enabled", !(await submitBtn.isDisabled()));
await submitBtn.click();
// 提交后应跳到 /orders/:id
await page.waitForURL(/\/orders\/\d+/);
await page.waitForSelector("text=订单 #");
const orderTitle = await page.locator("h1").textContent();
const orderId = orderTitle.match(/\d+/)[0];
check("跳转到订单详情页", /订单 #/.test(orderTitle), `(id=${orderId})`);
// 订单详情: 状态待确认 + 合计金额
const statusBadge = await page.locator(".badge").first().textContent();
check("订单状态=待确认", statusBadge === "待确认", `(badge=${statusBadge})`);
const totalText = await page.locator("text=/合计/").locator("..").textContent();
check("订单详情显示合计金额", /¥/.test(totalText), `(${totalText.replace(/\s+/g," ")})`);

// E2E-3 / E2E-4: 创建配送单 -> 追踪
await page.locator('button', { hasText: "创建配送单" }).click();
await page.waitForSelector("text=配送单 #");
await page.waitForTimeout(300);
check("创建配送单后显示配送信息", await page.locator("text=/配送单 #/").count() > 0);
// 点 查看配送追踪
await page.locator('a', { hasText: "查看配送追踪" }).click();
await page.waitForURL(/\/delivery\/\d+/);
await page.waitForSelector("text=配送追踪 #");
const deliveryTitle = await page.locator("h1").textContent();
check("跳转到配送追踪页", /配送追踪 #/.test(deliveryTitle), `(${deliveryTitle})`);
// 时间线 4 步，当前=待取货(pending)
const timelineItems = await page.locator(".timeline li").count();
check("配送时间线 4 步", timelineItems === 4, `(steps=${timelineItems})`);
const currentStep = await page.locator(".timeline li.current").textContent();
check("配送当前状态=待取货", currentStep === "待取货", `(current=${currentStep})`);
const feeText = await page.locator("text=/配送费/").textContent();
check("配送费显示 ¥5.00", /¥5/.test(feeText), `(${feeText.replace(/\s+/g," ")})`);
check("追踪页显示收货人", await page.locator("text=/收货人/").count() > 0);

// ---------- E2E-5b: 后端 400 兜底 (直连，UI 无法触发因前端禁用) ----------
console.log("E2E-5b 异常路径 (后端400兜底，经前端fetch封装)");
// 访问不存在的订单详情页 -> 应展示错误文案而非崩溃
await page.goto(BASE + "/orders/999999");
await page.waitForTimeout(500);
const errText = await page.locator(".error").first().textContent().catch(() => "");
check("访问不存在订单 显示错误而非崩溃", errText.length > 0, `(${errText.slice(0,40)})`);

await browser.close();
console.log(`\n=== E2E 结果: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
