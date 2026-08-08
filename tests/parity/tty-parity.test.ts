import { describe, expect, test } from "vitest";

import {
  ParityRepository,
  referenceDriver,
  requireSuccessfulCommand,
  maolStackDriver,
  type CliDriver,
  type CliResult,
} from "./parity-fixture.js";

const PARITY_REMOTE = "https://github.com/Maol-1997/claude-code-statusline.git";

describe("Reference CLI TTY parity", () => {
  test("matches interactive submit dry-run output in a pseudo-terminal", () => {
    expect(runInteractiveSubmit(maolStackDriver)).toEqual(
      runInteractiveSubmit(referenceDriver),
    );
  });

  test.each([
    ["current branch", "\r"],
    ["next branch", "\u001B[B\r"],
    ["wrapped previous branch", "\u001B[A\r"],
    ["filtered branch", "fea\r"],
    ["fallback branch", "zzz\r"],
  ])("matches checkout selection of the %s", (_, input) => {
    expect(runInteractiveCheckout(maolStackDriver, input)).toEqual(
      runInteractiveCheckout(referenceDriver, input),
    );
  });

  test("matches cancelling the checkout selector at EOF", () => {
    expect(runInteractiveCheckout(maolStackDriver)).toEqual(
      runInteractiveCheckout(referenceDriver),
    );
  });

  test("matches checkout selection for a forked stack", () => {
    expect(runForkedCheckout(maolStackDriver)).toEqual(
      runForkedCheckout(referenceDriver),
    );
  });

  test("matches a scrolled selector with more than ten branches", () => {
    expect(runLongCheckout(maolStackDriver)).toEqual(
      runLongCheckout(referenceDriver),
    );
  });
});

function runInteractiveSubmit(driver: CliDriver): CliResult {
  const repository = new ParityRepository(driver, PARITY_REMOTE);
  try {
    requireSuccessfulCommand(
      driver.run(repository, ["init", "--trunk", "main"]),
    );
    repository.write("first.txt", "first\n");
    requireSuccessfulCommand(
      driver.run(repository, [
        "create",
        "first",
        "--all",
        "--message",
        "first",
      ]),
    );
    return driver.runInTty(repository, [
      "submit",
      "--dry-run",
      "--no-edit",
      "--interactive",
    ]);
  } finally {
    repository.dispose();
  }
}

function runInteractiveCheckout(driver: CliDriver, input?: string): CliResult {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    repository.write("feature.txt", "feature\n");
    requireSuccessfulCommand(
      driver.run(repository, [
        "create",
        "feature",
        "--all",
        "--message",
        "feature",
      ]),
    );
    return driver.runInTty(repository, ["checkout", "--interactive"], input);
  } finally {
    repository.dispose();
  }
}

function runForkedCheckout(driver: CliDriver): CliResult {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createBranch(repository, "alpha");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "main"]));
    createBranch(repository, "beta");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "main"]));
    return driver.runInTty(repository, ["checkout", "--interactive"], "\r");
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

function runLongCheckout(driver: CliDriver): CliResult {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    for (let index = 1; index <= 11; index += 1) {
      const branch = `branch-${String(index).padStart(2, "0")}`;
      repository.git(["checkout", "--quiet", "-b", branch, "main"]);
      repository.git([
        "commit",
        "--allow-empty",
        "--quiet",
        "--message",
        branch,
      ]);
      requireSuccessfulCommand(
        driver.run(repository, ["track", branch, "--parent", "main"]),
      );
    }
    requireSuccessfulCommand(driver.run(repository, ["checkout", "main"]));
    return driver.runInTty(repository, ["checkout", "--interactive"], "\r");
  } finally {
    repository.dispose();
  }
}
