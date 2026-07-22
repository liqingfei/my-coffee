const fs = require("fs");
const os = require("os");
const path = require("path");

// 拼装 PG 测试连接串（A2 §7）：
// - 凭证读仓库外 ~/.aliyun-env（admin 账号，同机共享；凭证不进仓库/日志）
// - 库 = 同实例独立库 mycoffee_test，与 dev 库隔离
// - 池大小 2 钉在串尾（connection_limit=2 即测试池的全部配置，
//   单一事实源——不再另设 TEST_CONNECTION_LIMIT env，A4 §7 / CR 处方）
function buildTestDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(os.homedir(), ".aliyun-env");
  const src = fs.readFileSync(envPath, "utf8");
  const env = {};
  for (const line of src.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  const { RDS_PG_ENDPOINT, RDS_PG_ADMIN_USER, RDS_PG_ADMIN_PWD } = env;
  if (!RDS_PG_ENDPOINT || !RDS_PG_ADMIN_USER || !RDS_PG_ADMIN_PWD) {
    throw new Error(
      "~/.aliyun-env 缺少 RDS_PG_ENDPOINT / RDS_PG_ADMIN_USER / RDS_PG_ADMIN_PWD",
    );
  }
  const host = RDS_PG_ENDPOINT.replace(/^postgresql?:\/\//, "").replace(
    /[:/].*$/,
    "",
  );
  return `postgresql://${RDS_PG_ADMIN_USER}:${encodeURIComponent(RDS_PG_ADMIN_PWD)}@${host}:5432/mycoffee_test?connection_limit=2`;
}

module.exports = { buildTestDatabaseUrl };
