import { describe, expect, test } from "vitest";

import {
  ParityRepository,
  referenceDriver,
  requireSuccessfulCommand,
  maolStackDriver,
  type CliDriver,
  type CliResult,
} from "./parity-fixture.js";

describe("Reference CLI log option parity", () => {
  test("matches filtering, orientation, and untracked branch options", () => {
    expect(runLogOptions(maolStackDriver)).toEqual(
      runLogOptions(referenceDriver),
    );
  });
});

function runLogOptions(driver: CliDriver): CliResult[] {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createBranch(repository, "first");
    createBranch(repository, "second");
    repository.git(["checkout", "--quiet", "main"]);
    repository.git(["checkout", "--quiet", "-b", "untracked"]);
    repository.git(["commit", "--allow-empty", "--quiet", "-m", "untracked"]);
    repository.git(["checkout", "--quiet", "second"]);
    return [
      driver.run(repository, ["log", "short", "--reverse"]),
      driver.run(repository, ["log", "short", "--stack"]),
      driver.run(repository, ["log", "short", "--steps", "1"]),
      driver.run(repository, ["log", "short", "--show-untracked"]),
      driver.run(repository, ["log", "short", "--all"]),
      driver.run(repository, ["log", "--classic"]),
    ];
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
