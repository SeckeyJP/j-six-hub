/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // GitHub Pages ではリポジトリ名のパス配下に置かれる
  base: process.env.GITHUB_PAGES ? "/j-six-hub/" : "/",
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
    // 画面全体を描いて操作するテストがあり、並列実行では 5 秒では足りないことがある
    testTimeout: 20000,
    coverage: { include: ["src/**", "scripts/**"], exclude: ["**/*.test.*", "src/test/**"] },
  },
});
