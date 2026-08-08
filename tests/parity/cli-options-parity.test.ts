import { describe, expect, test } from "vitest";

import {
  ParityRepository,
  referenceDriver,
  requireSuccessfulCommand,
  maolStackDriver,
  type CliDriver,
  type CliResult,
} from "./parity-fixture.js";

describe("Reference CLI stack CLI option parity", () => {
  test("matches checkout selection options with an explicit branch", () => {
    expect(runCheckoutOptions(maolStackDriver)).toEqual(
      runCheckoutOptions(referenceDriver),
    );
  });

  test("matches non-interactive selector failures", () => {
    expect(runSelectorFailures(maolStackDriver)).toEqual(
      runSelectorFailures(referenceDriver),
    );
  });

  test("matches explicit untracked and missing branch checkout", () => {
    expect(runUntrackedCheckout(maolStackDriver)).toEqual(
      runUntrackedCheckout(referenceDriver),
    );
  });

  test.each([
    ["--upstack", "--downstack"],
    ["--downstack", "--only"],
    ["--upstack", "--only"],
    ["--upstack", "--downstack", "--only"],
  ])("matches restack scope precedence for %s", (...scopes) => {
    expect(runConflictingRestackScopes(maolStackDriver, scopes)).toEqual(
      runConflictingRestackScopes(referenceDriver, scopes),
    );
  });

  test("matches positional multi-level navigation", () => {
    expect(runPositionalNavigation(maolStackDriver)).toEqual(
      runPositionalNavigation(referenceDriver),
    );
  });
});

function runCheckoutOptions(driver: CliDriver): CliResult[] {
  return withStack(driver, (repository) => [
    driver.run(repository, [
      "checkout",
      "first",
      "--show-untracked",
      "--stack",
      "--all",
    ]),
    driver.run(repository, ["checkout", "--trunk"]),
  ]);
}

function runSelectorFailures(driver: CliDriver): CliResult[] {
  return withStack(driver, (repository) => [
    driver.run(repository, ["checkout", "--no-interactive"]),
    driver.run(repository, ["move", "--no-interactive"]),
  ]);
}

function runUntrackedCheckout(driver: CliDriver): CliResult[] {
  return withStack(driver, (repository) => {
    repository.git(["branch", "untracked"]);
    return [
      driver.run(repository, ["checkout", "untracked"]),
      driver.run(repository, ["checkout", "missing"]),
    ];
  });
}

function runConflictingRestackScopes(
  driver: CliDriver,
  scopes: readonly string[],
): unknown {
  return withStack(driver, (repository) => {
    createBranch(repository, "second");
    createBranch(repository, "third");
    repository.git(["checkout", "--quiet", "first"]);
    repository.git([
      "commit",
      "--amend",
      "--allow-empty",
      "--quiet",
      "--message",
      "first updated",
    ]);
    repository.git(["checkout", "--quiet", "second"]);
    const result = driver.run(repository, ["restack", ...scopes]);
    return {
      result,
      state: repository.observe(["main", "first", "second", "third"]),
    };
  });
}

function runPositionalNavigation(driver: CliDriver): CliResult[] {
  return withStack(driver, (repository) => {
    repository.write("second.txt", "second\n");
    requireSuccessfulCommand(
      driver.run(repository, [
        "create",
        "second",
        "--all",
        "--message",
        "second",
      ]),
    );
    requireSuccessfulCommand(driver.run(repository, ["checkout", "main"]));
    return [
      driver.run(repository, ["up", "2"]),
      driver.run(repository, ["down", "2"]),
    ];
  });
}

function withStack<T>(
  driver: CliDriver,
  scenario: (repository: ParityRepository) => T,
): T {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
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
    return scenario(repository);
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
