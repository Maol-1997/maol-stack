import { describe, expect, test } from "vitest";

import {
  ParityRepository,
  referenceDriver,
  requireSuccessfulCommand,
  maolStackDriver,
  type CliDriver,
  type CliResult,
} from "./parity-fixture.js";

describe("Reference CLI log parity", () => {
  test("matches every built-in log form and alias", () => {
    expect(runLogForms(maolStackDriver)).toEqual(runLogForms(referenceDriver));
  });
});

function runLogForms(driver: CliDriver): CliResult[] {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createBranch(repository, "first");
    createBranch(repository, "second");
    return [
      driver.run(repository, ["log"]),
      driver.run(repository, ["log", "short"]),
      driver.run(repository, ["log", "long"]),
      driver.run(repository, ["l"]),
      driver.run(repository, ["ls"]),
      driver.run(repository, ["ll"]),
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
