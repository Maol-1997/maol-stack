import { describe, expect, test } from "vitest";

import {
  ParityRepository,
  referenceDriver,
  requireSuccessfulCommand,
  maolStackDriver,
  type CliDriver,
  type CliResult,
} from "./parity-fixture.js";

const SUBMIT_ARGS = [
  "submit",
  "--dry-run",
  "--no-edit",
  "--no-interactive",
] as const;
const PARITY_REMOTE = "https://github.com/Maol-1997/claude-code-statusline.git";

describe("Reference CLI submit error parity", () => {
  test("matches a dirty working tree", () => {
    expect(runDirtySubmit(maolStackDriver)).toEqual(
      runDirtySubmit(referenceDriver),
    );
  });

  test("matches an untracked current branch", () => {
    expect(runUntrackedSubmit(maolStackDriver)).toEqual(
      runUntrackedSubmit(referenceDriver),
    );
  });

  test("matches a repository without a GitHub remote", () => {
    expect(
      normalizeRepositoryIdentityError(runMissingRemoteSubmit(maolStackDriver)),
    ).toEqual(
      normalizeRepositoryIdentityError(runMissingRemoteSubmit(referenceDriver)),
    );
  });
});

function runDirtySubmit(driver: CliDriver): CliResult {
  return withRemoteRepository(driver, (repository) => {
    requireSuccessfulCommand(
      driver.run(repository, ["init", "--trunk", "main"]),
    );
    createFirstBranch(repository);
    repository.write("dirty.txt", "dirty\n");
    return driver.run(repository, SUBMIT_ARGS);
  });
}

function normalizeRepositoryIdentityError(result: CliResult): CliResult {
  return {
    ...result,
    stderr: result.stderr.replace(
      /Could not determine the (?:owner|name) of this repo \(e\.g\. '[^']+' in the repo '[^']+'\)\. Please use `[^`]+` to manually set the repo (?:owner|name)\./,
      "Could not determine the repository identity.",
    ),
  };
}

function withRemoteRepository(
  driver: CliDriver,
  scenario: (repository: ParityRepository) => CliResult,
): CliResult {
  const repository = new ParityRepository(driver, PARITY_REMOTE);
  try {
    return scenario(repository);
  } finally {
    repository.dispose();
  }
}

function runUntrackedSubmit(driver: CliDriver): CliResult {
  return withRepository(driver, (repository) => {
    repository.initializeEmpty();
    repository.git(["checkout", "--quiet", "-b", "untracked"]);
    repository.git(["commit", "--allow-empty", "--quiet", "-m", "untracked"]);
    return driver.run(repository, SUBMIT_ARGS);
  });
}

function runMissingRemoteSubmit(driver: CliDriver): CliResult {
  return withRepository(driver, (repository) => {
    createTrackedBranch(repository);
    return driver.run(repository, SUBMIT_ARGS);
  });
}

function createTrackedBranch(repository: ParityRepository): void {
  repository.initializeEmpty();
  createFirstBranch(repository);
}

function createFirstBranch(repository: ParityRepository): void {
  repository.write("first.txt", "first\n");
  requireSuccessfulCommand(
    repository.driver.run(repository, [
      "create",
      "first",
      "--all",
      "--message",
      "first",
    ]),
  );
}

function withRepository(
  driver: CliDriver,
  scenario: (repository: ParityRepository) => CliResult,
): CliResult {
  const repository = new ParityRepository(driver);
  try {
    return scenario(repository);
  } finally {
    repository.dispose();
  }
}
