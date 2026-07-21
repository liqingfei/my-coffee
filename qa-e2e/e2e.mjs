import { chromium } from "playwright";

// 可选：通过 CHROME_PATH 指定 chromium 可执行路径；不设则用 Playwright 自带 chromium。
// 用法示例：CHROME_PATH=/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome node qa-e2e/e2e.mjs
// E2E_BASE_URL 覆盖前端地址（默认 http://127.0.0.1:5173，/api 经 vite 代理到后端 3001）。
const CHROME = process.env.CHROME_PATH;
const launchOpts = CHROME ? { executablePath: CHROME } : {};
const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✅ ${name} ${extra}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

const browser = await chromium.launch(launchOpts);

// ---------- P0-2: 下单页菜单 loading 态（throttle /api/menu 捕获 loading） ----------
console.log("P0-2 下单页 loading 态");
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await page.route("**/api/menu", async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });
  await page.goto(BASE + "/order");
  await page.waitForSelector("text=加载菜单中");
  check("P0-2 loading 态先现", true, "(加载菜单中…)");
  await page.waitForSelector(".card");
  const cards = await page.locator(".card").count();
  check("P0-2 loading 后出卡片", cards > 0, `(cards=${cards})`);
  await ctx.close();
}

// ---------- E2E-2: 菜单分类筛选 ----------
console.log("E2E-2 菜单分类筛选");
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(BASE + "/");
  await page.waitForSelector("text=咖啡菜单");
  const allCards = await page.locator(".card").count();
  check("菜单页加载卡片数>0", allCards > 0, `(cards=${allCards})`);
  await page.locator(".chip", { hasText: "咖啡" }).first().click();
  await page.waitForTimeout(300);
  const coffeeCards = await page.locator(".card").count();
  const allCoffee = (await page.locator(".card .tag").allInnerTexts()).every((t) => t === "咖啡");
  check("分类=咖啡 仅显示咖啡项", allCoffee, `(cards=${coffeeCards})`);
  await page.locator(".chip", { hasText: "全部" }).click();
  await page.waitForTimeout(300);
  check("切回全部 卡片恢复", (await page.locator(".card").count()) === allCards);
  await ctx.close();
}

// ---------- E2E-5 异常路径(前端校验) + P0 防重提交 + P0-3 banner + P0-1 二次确认 + E2E-1 下单→配送 ----------
console.log("E2E-5 异常路径 / P0 防重提交 / P0-3 banner / P0-1 二次确认 / E2E-1 下单→配送");
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);

  // --- E2E-5: 空表单前端校验 ---
  await page.goto(BASE + "/order");
  await page.waitForSelector("text=下单");
  const submitBtn = page.locator("button[type=submit]");
  check("空表单 提交按钮 disabled", await submitBtn.isDisabled());
  check("提示文案出现", (await page.locator("text=请至少选择 1 件商品").count()) > 0);
  await page.locator(".card", { hasText: "美式咖啡" }).locator("button").last().click(); // +1
  check("有商品无信息 提交仍 disabled", await submitBtn.isDisabled());

  // --- P0 防重提交：throttle POST /api/orders，点提交后按钮 disabled + 文案「提交中…」 ---
  let orderPosts = 0;
  page.on("request", (req) => {
    if (req.url().includes("/api/orders") && req.method() === "POST") orderPosts++;
  });
  await page.route("**/api/orders", async (route) => {
    await new Promise((r) => setTimeout(r, 700));
    await route.continue();
  });
  // 再点 +1（累计 qty=2）
  await page.locator(".card", { hasText: "美式咖啡" }).locator("button").last().click();
  await page.locator('input[placeholder="张三"]').fill("QA用户");
  await page.locator('input[placeholder="13800000000"]').fill("13800000000");
  await page.locator('input[placeholder="杭州市西湖区文一西路 100 号"]').fill("QA地址");
  check("表单填满 提交按钮 enabled", !(await submitBtn.isDisabled()));
  await submitBtn.click();
  await page.waitForTimeout(150); // 落在 700ms throttle 窗口内
  check("P0 防重提交 按钮 disabled", await submitBtn.isDisabled(), "(提交中…)");
  check("P0 防重提交 文案=提交中", (await submitBtn.textContent()).includes("提交中"));
  await page.waitForURL(/\/orders\/\d+/);
  await page.unroute("**/api/orders");
  check("P0 防重提交 仅发一次 POST", orderPosts === 1, `(posts=${orderPosts})`);

  // --- P0-3: 下单成功 banner（navigate state fromSubmit） ---
  await page.waitForSelector(".banner-success");
  const bannerText = (await page.locator(".banner-success").textContent()).replace(/\s+/g, " ");
  check("P0-3 提交后 banner 出现", /订单提交成功/.test(bannerText), `(${bannerText})`);
  // 订单详情
  await page.waitForSelector("text=订单 #");
  const orderTitle = await page.locator("h1").textContent();
  const orderId = orderTitle.match(/\d+/)[0];
  check("跳转到订单详情页", /订单 #/.test(orderTitle), `(id=${orderId})`);
  const statusBadge = await page.locator(".badge").first().textContent();
  check("订单状态=待确认", statusBadge === "待确认", `(badge=${statusBadge})`);
  const totalText = (await page.locator("text=/合计/").locator("..").textContent()).replace(/\s+/g, " ");
  check("订单详情显示合计金额", /¥/.test(totalText), `(${totalText})`);

  // --- P0-3: banner 关闭 ---
  await page.locator("button[aria-label=关闭]").click();
  await page.waitForTimeout(200);
  check("P0-3 banner 关闭后隐藏", (await page.locator(".banner-success").count()) === 0);

  // --- P0-1: 创建配送单二次确认（先 dismiss：取消则不发请求、不创建） ---
  // window.confirm 同步阻塞页面，必须用 page.once('dialog') 在触发瞬间 dismiss/accept 解除阻塞，
  // 否则 click action 等 dialog settle 不到而超时（waitForEvent 只是等事件、不自动处理）。
  let deliveryPosts = 0;
  page.on("request", (req) => {
    if (req.url().includes("/api/deliveries") && req.method() === "POST") deliveryPosts++;
  });
  const createBtn = page.locator("button", { hasText: "创建配送单" });
  check("创建配送单按钮可见", (await createBtn.count()) > 0);
  {
    const msgPromise = new Promise((resolve) => {
      page.once("dialog", async (dialog) => {
        resolve(dialog.message());
        await dialog.dismiss(); // 取消
      });
    });
    await createBtn.click();
    const msg = await msgPromise;
    check("P0-1 confirm 文案", /确认创建配送单/.test(msg), `(${msg})`);
  }
  await page.waitForTimeout(300);
  check("P0-1 取消 无配送单创建", (await page.locator("text=/配送单 #/").count()) === 0);
  check("P0-1 取消 仍显示创建按钮", (await page.locator("button", { hasText: "创建配送单" }).count()) > 0);
  check("P0-1 取消 无 POST /api/deliveries", deliveryPosts === 0, `(posts=${deliveryPosts})`);

  // --- P0-1: 确认路径 -> 创建配送单 ---
  {
    const msgPromise = new Promise((resolve) => {
      page.once("dialog", async (dialog) => {
        resolve(dialog.message());
        await dialog.accept(); // 确认
      });
    });
    await createBtn.click();
    await msgPromise;
  }
  await page.waitForSelector("text=/配送单 #/");
  await page.waitForTimeout(300);
  check("P0-1 确认 创建配送单", (await page.locator("text=/配送单 #/").count()) > 0);
  check("P0-1 确认 发了 POST", deliveryPosts === 1, `(posts=${deliveryPosts})`);

  // --- E2E-3 / E2E-4: 配送追踪 ---
  await page.locator("a", { hasText: "查看配送追踪" }).click();
  await page.waitForURL(/\/delivery\/\d+/);
  await page.waitForSelector("text=配送追踪 #");
  const deliveryTitle = await page.locator("h1").textContent();
  check("跳转到配送追踪页", /配送追踪 #/.test(deliveryTitle), `(${deliveryTitle})`);
  const timelineItems = await page.locator(".timeline li").count();
  check("配送时间线 4 步", timelineItems === 4, `(steps=${timelineItems})`);
  const currentStep = await page.locator(".timeline li.current").textContent();
  check("配送当前状态=待取货", currentStep === "待取货", `(current=${currentStep})`);
  const feeText = (await page.locator("text=/配送费/").textContent()).replace(/\s+/g, " ");
  check("配送费显示 ¥5.00", /¥5/.test(feeText), `(${feeText})`);
  check("追踪页显示收货人", (await page.locator("text=/收货人/").count()) > 0);

  // --- P0-3: 直访无 banner（新 page 全新 history，不用 reload 避免保留 pushState state） ---
  const freshPage = await ctx.newPage();
  await freshPage.goto(`${BASE}/orders/${orderId}`);
  await freshPage.waitForSelector("h1");
  await freshPage.waitForTimeout(300);
  check("P0-3 直访无 banner", (await freshPage.locator(".banner-success").count()) === 0);
  await freshPage.close();
  await ctx.close();
}

// ---------- P1: 375px 视口响应式（订单详情不溢出） ----------
console.log("P1 375px 视口响应式");
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(BASE + "/order");
  await page.waitForSelector(".card");
  await page.locator(".card", { hasText: "美式咖啡" }).locator("button").last().click();
  await page.locator('input[placeholder="张三"]').fill("QA375");
  await page.locator('input[placeholder="13800000000"]').fill("13800000001");
  await page.locator('input[placeholder="杭州市西湖区文一西路 100 号"]').fill("375地址");
  await page.locator("button[type=submit]").click();
  await page.waitForURL(/\/orders\/\d+/);
  await page.waitForSelector("h1");
  await page.waitForTimeout(300);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  check("P1 375px 无横向溢出", scrollWidth <= 375, `(scrollWidth=${scrollWidth})`);
  await ctx.close();
}

// ---------- E2E-5b: 后端 400 兜底（直访不存在订单，展示错误而非崩溃） ----------
console.log("E2E-5b 异常路径 (后端400兜底)");
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(BASE + "/orders/999999");
  await page.waitForTimeout(800);
  const errText = (await page.locator(".error").first().textContent().catch(() => "")).slice(0, 40);
  check("访问不存在订单 显示错误而非崩溃", errText.length > 0, `(${errText})`);
  await ctx.close();
}

await browser.close();
console.log(`\n=== E2E 结果: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
