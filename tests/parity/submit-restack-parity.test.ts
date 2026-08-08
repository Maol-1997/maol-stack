import { describe, expect, test } from "vitest";

import {
  ParityRepository,
  referenceDriver,
  requireSuccessfulCommand,
  maolStackDriver,
  type CliDriver,
} from "./parity-fixture.js";

const PARITY_REMOTE = "https://github.com/Maol-1997/claude-code-statusline.git";

describe("Reference CLI submit restack parity", () => {
  test("does not restack branches during a dry run", () => {
    expect(runRestackDryRun(maolStackDriver)).toEqual(
      runRestackDryRun(referenceDriver),
    );
  });
});

function runRestackDryRun(driver: CliDriver): unknown {
  const repository = new ParityRepository(driver, PARITY_REMOTE);
  try {
    requireSuccessfulCommand(
      driver.run(repository, ["init", "--trunk", "main"]),
    );
    createBranch(repository, "first");
    createBranch(repository, "second");
    repository.git(["checkout", "--quiet", "first"]);
    repository.write("first.txt", "first updated\n");
    repository.git(["add", "first.txt"]);
    repository.git(["commit", "--quiet", "--amend", "--no-edit"]);
    repository.git(["checkout", "--quiet", "second"]);
    const result = driver.run(repository, [
      "submit",
      "--stack",
      "--restack",
      "--dry-run",
      "--no-edit",
      "--no-interactive",
    ]);
    return {
      result,
      state: repository.observe(["main", "first", "second"]),
    };
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
