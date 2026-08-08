import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: true,
    include: ["tests/parity/**/*.test.ts"],
    testTimeout: 120_000,
  },
});
