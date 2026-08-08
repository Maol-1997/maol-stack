import { describe, expect, test } from "vitest";

import {
  ParityRepository,
  referenceDriver,
  requireSuccessfulCommand,
  maolStackDriver,
  type CliDriver,
} from "./parity-fixture.js";

describe("Reference CLI navigation edge parity", () => {
  test.each(["0", "-1", "abc", "1.5", "5"])(
    "matches up --steps %s",
    (steps) => {
      expect(runNavigation(maolStackDriver, "up", steps)).toEqual(
        runNavigation(referenceDriver, "up", steps),
      );
    },
  );

  test.each(["0", "-1", "abc", "1.5", "5"])(
    "matches down --steps %s",
    (steps) => {
      expect(runNavigation(maolStackDriver, "down", steps)).toEqual(
        runNavigation(referenceDriver, "down", steps),
      );
    },
  );

  test.each(["0", "-2", "abc", "1.5"])("matches log --steps %s", (steps) => {
    expect(runLogEdge(maolStackDriver, ["--steps", steps])).toEqual(
      runLogEdge(referenceDriver, ["--steps", steps]),
    );
  });

  test("matches an unknown log format", () => {
    expect(runLogEdge(maolStackDriver, ["bogus"])).toEqual(
      runLogEdge(referenceDriver, ["bogus"]),
    );
  });
});

function runNavigation(
  driver: CliDriver,
  direction: "down" | "up",
  steps: string,
): unknown {
  const repository = createThreeBranchStack(driver);
  try {
    const start = direction === "up" ? "first" : "third";
    requireSuccessfulCommand(driver.run(repository, ["checkout", start]));
    return {
      result: driver.run(repository, [direction, "--steps", steps]),
      state: repository.observe(["main", "first", "second", "third"]),
    };
  } finally {
    repository.dispose();
  }
}

function runLogEdge(driver: CliDriver, args: readonly string[]): unknown {
  const repository = createThreeBranchStack(driver);
  try {
    requireSuccessfulCommand(driver.run(repository, ["checkout", "second"]));
    return driver.run(repository, ["log", ...args]);
  } finally {
    repository.dispose();
  }
}

function createThreeBranchStack(driver: CliDriver): ParityRepository {
  const repository = new ParityRepository(driver);
  repository.initializeEmpty();
  for (const branch of ["first", "second", "third"]) {
    repository.write(`${branch}.txt`, `${branch}\n`);
    requireSuccessfulCommand(
      driver.run(repository, ["create", branch, "--all", "--message", branch]),
    );
  }
  return repository;
}
