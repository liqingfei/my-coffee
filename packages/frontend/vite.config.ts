import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 开发期将 /api 代理到后端（http://localhost:3001），避免跨域
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3001", changeOrigin: true },
    },
  },
});
