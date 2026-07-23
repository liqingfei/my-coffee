import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// 单测配置（独立于 vite.config.ts 的 dev server 配置）。
// coverage 只统计本次新增/改动的业务文件，对齐 QA 门禁：新文件行覆盖 ≥80%。
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: [
        "src/api.ts",
        "src/pages/OrderListPage.tsx",
        "src/hooks/useCreateDelivery.ts",
      ],
      thresholds: {
        lines: 80,
        statements: 80,
      },
    },
  },
});
