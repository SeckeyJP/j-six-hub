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
    coverage: { include: ["src/**", "scripts/**"], exclude: ["**/*.test.*", "src/test/**"] },
  },
});
