import { describe, expect, test } from "vitest";

import {
  ParityRepository,
  referenceDriver,
  requireSuccessfulCommand,
  maolStackDriver,
  type CliDriver,
  type CliResult,
} from "./parity-fixture.js";

describe("Reference CLI navigation and tracking prompt parity", () => {
  test("matches interactive move parent selection", () => {
    expect(runInteractiveMove(maolStackDriver, "\u001B[B\r")).toEqual(
      runInteractiveMove(referenceDriver, "\u001B[B\r"),
    );
  });

  test("matches fuzzy text in the move parent selector", () => {
    expect(runInteractiveMove(maolStackDriver, "gam\r")).toEqual(
      runInteractiveMove(referenceDriver, "gam\r"),
    );
  });

  test("matches interactive tracking parent selection", () => {
    expect(runInteractiveTrack(maolStackDriver, "\r")).toEqual(
      runInteractiveTrack(referenceDriver, "\r"),
    );
  });

  test("matches cancelling the tracking selector at EOF", () => {
    expect(runInteractiveTrack(maolStackDriver)).toEqual(
      runInteractiveTrack(referenceDriver),
    );
  });

  test("matches recursively tracking an untracked parent", () => {
    expect(runRecursiveTrack(maolStackDriver)).toEqual(
      runRecursiveTrack(referenceDriver),
    );
  });

  test("matches confirmation when untracking a branch with children", () => {
    expect(runInteractiveUntrack(maolStackDriver, "y\r")).toEqual(
      runInteractiveUntrack(referenceDriver, "y\r"),
    );
  });

  test("matches declining recursive untrack", () => {
    expect(runInteractiveUntrack(maolStackDriver, "\r")).toEqual(
      runInteractiveUntrack(referenceDriver, "\r"),
    );
  });

  test("matches cancelling recursive untrack at EOF", () => {
    expect(runInteractiveUntrack(maolStackDriver)).toEqual(
      runInteractiveUntrack(referenceDriver),
    );
  });
});

function runInteractiveMove(driver: CliDriver, input: string): CliResult {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createBranch(repository, "alpha");
    createBranch(repository, "beta");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "main"]));
    createBranch(repository, "gamma");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "beta"]));
    return driver.runInTty(repository, ["move", "--interactive"], input);
  } finally {
    repository.dispose();
  }
}

function runInteractiveTrack(driver: CliDriver, input?: string): CliResult {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createBranch(repository, "alpha");
    repository.git(["checkout", "--quiet", "-b", "untracked"]);
    repository.git([
      "commit",
      "--allow-empty",
      "--quiet",
      "--message",
      "untracked",
    ]);
    return driver.runInTty(repository, ["track", "--interactive"], input);
  } finally {
    repository.dispose();
  }
}

function runInteractiveUntrack(driver: CliDriver, input?: string): CliResult {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createBranch(repository, "alpha");
    createBranch(repository, "beta");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "alpha"]));
    return driver.runInTty(repository, ["untrack", "--interactive"], input);
  } finally {
    repository.dispose();
  }
}

function runRecursiveTrack(driver: CliDriver): CliResult {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    repository.git(["checkout", "--quiet", "-b", "alpha"]);
    repository.git([
      "commit",
      "--allow-empty",
      "--quiet",
      "--message",
      "alpha",
    ]);
    repository.git(["checkout", "--quiet", "-b", "beta"]);
    repository.git(["commit", "--allow-empty", "--quiet", "--message", "beta"]);
    return driver.runInTty(repository, ["track", "--interactive"], "\r");
  } finally {
    repository.dispose();
  }
}

function createBranch(repository: ParityRepository, branch: string): void {
  repository.write(`${branch}.txt`, `${branch}\n`);
  requireSuccessfulCommand(
    repository.driver.run(repository, [
      "create",
      branch,
      "--all",
      "--message",
      branch,
    ]),
  );
}
