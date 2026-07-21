// 必须在 PrismaClient 实例化前设置，指向 PG 测试库（mycoffee_test）。
// URL 含串尾 connection_limit=2（测试池单一事实源，见 jest.env.js）。
process.env.DATABASE_URL = require("./jest.env").buildTestDatabaseUrl();
