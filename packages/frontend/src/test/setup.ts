import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// 每个用例后卸载 DOM，避免跨用例串扰
afterEach(() => {
  cleanup();
});
