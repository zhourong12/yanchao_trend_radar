import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      exclude: ["src/test/**", "src/server/index.ts", "src/server/types/**"],
      thresholds: {
        lines: 70,
        functions: 55,
        branches: 50,
        statements: 65
      }
    }
  }
});
