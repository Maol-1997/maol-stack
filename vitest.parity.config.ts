import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ["tests/parity/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
