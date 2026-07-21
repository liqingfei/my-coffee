const { execSync } = require("child_process");
const path = require("path");
const { buildTestDatabaseUrl } = require("./jest.env");

// 测试前用独立 PG 库（mycoffee_test）同步 schema，与 dev 库隔离（A2 §7）。
// --force-reset：全量重置 schema（C1 保持原语义；reset 一次 + 文件间 TRUNCATE
// 的优化归 C2 测试迁移）。缺库由 admin 账号自动创建。
module.exports = function globalSetup() {
  const backendDir = path.resolve(__dirname, "..");
  execSync("npx prisma db push --skip-generate --force-reset", {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: buildTestDatabaseUrl() },
    stdio: "inherit",
  });
};
