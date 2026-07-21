const { execSync } = require("child_process");
const path = require("path");
const { buildTestDatabaseUrl } = require("./jest.env");

// 测试前对独立 PG 库（mycoffee_test）跑一次 `migrate reset --force`（A4 §三）：
// drop schema → 重放全部 migration → seed，整个 run 只一次。
// 用 `migrate reset`（非 C1 的 `db push --force-reset`）的关键理由：验证 C1 重生成的
// migration 历史能干净 apply——这正是 C3 FC 冷启动 `migrate deploy` 走的路径，
// 这里先验一遍，不留"dev push 过、deploy 没跑过"的缝给 C3（CR 5xr1utmj 处方2）。
// 文件间隔离用 TRUNCATE（见 helpers.resetDb），不每文件重跑 reset。
// 缺库由 admin 账号自动创建（C1 实测，createdb 权限）。
module.exports = function globalSetup() {
  const backendDir = path.resolve(__dirname, "..");
  execSync("npx prisma migrate reset --force", {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: buildTestDatabaseUrl() },
    stdio: "inherit",
  });
};
