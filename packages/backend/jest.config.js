/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  // 建库（独立 PG 库 mycoffee_test，与 dev 库隔离，A2 §7）
  globalSetup: "<rootDir>/tests/jest.globalSetup.js",
  // 每个测试进程运行前设置 DATABASE_URL，确保 PrismaClient 连接测试库
  setupFiles: ["<rootDir>/tests/jest.setup.js"],
  collectCoverageFrom: [
    "src/services/**/*.ts",
    "src/routes/**/*.ts",
    "src/lib/status.ts",
  ],
  coverageThreshold: {
    global: { lines: 80, statements: 80, functions: 80, branches: 70 },
  },
};
