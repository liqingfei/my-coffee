const { execSync } = require("child_process");
const path = require("path");

// 测试前用独立 SQLite 文件(test.db)同步 schema，避免污染 dev.db
module.exports = function globalSetup() {
  const backendDir = path.resolve(__dirname, "..");
  execSync("npx prisma db push --skip-generate --force-reset", {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "inherit",
  });
};
