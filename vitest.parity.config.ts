import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: true,
    include: ["tests/parity/**/*.test.ts"],
    // Each comparison spawns two full CLIs and several git processes, so one
    // worker per core oversubscribes the machine badly enough to starve the
    // main thread and time out its own reporter RPC.
    maxWorkers: 6,
    // The TTY comparisons emulate a real terminal, so under the contention of
    // parallel files their repaints can interleave differently between the two
    // CLIs and produce a spurious diff. Retrying separates that noise from a
    // genuine divergence, which fails every attempt.
    retry: 2,
    testTimeout: 120_000,
  },
});
