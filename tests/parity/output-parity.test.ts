import { describe, expect, test } from "vitest";

import {
  ParityRepository,
  referenceDriver,
  stacklineDriver,
  type CliDriver,
  type CliResult,
  requireSuccessfulCommand,
} from "./parity-fixture.js";

describe("Reference CLI output parity", () => {
  test("matches initialization, empty creation, log, and no-op restack", () => {
    expect(runBasicTranscript(stacklineDriver)).toEqual(
      runBasicTranscript(referenceDriver),
    );
  });

  test("matches creation with committed changes", () => {
    expect(runCreateTranscript(stacklineDriver)).toEqual(
      runCreateTranscript(referenceDriver),
    );
  });

  test("matches navigation and relationship output", () => {
    expect(runNavigationTranscript(stacklineDriver)).toEqual(
      runNavigationTranscript(referenceDriver),
    );
  });

  test("matches modify with a clean automatic restack", () => {
    expect(runModifyTranscript(stacklineDriver)).toEqual(
      runModifyTranscript(referenceDriver),
    );
  });

  test("matches tracking and forced untracking", () => {
    expect(runTrackingTranscript(stacklineDriver)).toEqual(
      runTrackingTranscript(referenceDriver),
    );
  });

  test("matches tracking a branch diverged from its parent", () => {
    expect(runDivergedTrackingTranscript(stacklineDriver)).toEqual(
      runDivergedTrackingTranscript(referenceDriver),
    );
  });

  test("matches common non-interactive errors", () => {
    expect(runErrorTranscript(stacklineDriver)).toEqual(
      runErrorTranscript(referenceDriver),
    );
  });

  test("matches force tracking and directed navigation", () => {
    expect(runExtendedNavigationTranscript(stacklineDriver)).toEqual(
      runExtendedNavigationTranscript(referenceDriver),
    );
  });

  test("matches resetting tracked metadata", () => {
    expect(runResetTranscript(stacklineDriver)).toEqual(
      runResetTranscript(referenceDriver),
    );
  });

  test("matches the short-log alias and quiet output", () => {
    expect(runAliasAndQuietTranscript(stacklineDriver)).toEqual(
      runAliasAndQuietTranscript(referenceDriver),
    );
  });
});

function runBasicTranscript(driver: CliDriver): CliResult[] {
  return withRepository(driver, (repository) => {
    repository.git([
      "commit",
      "--allow-empty",
      "--quiet",
      "--message",
      "trunk",
    ]);
    return [
      driver.run(repository, ["init", "--trunk", "main"]),
      driver.run(repository, ["create", "first", "--message", "first"]),
      driver.run(repository, ["log", "short"]),
      driver.run(repository, ["restack", "--upstack"]),
    ];
  });
}

function runCreateTranscript(driver: CliDriver): CliResult[] {
  return withRepository(driver, (repository) => {
    repository.initializeEmpty();
    repository.write("first.txt", "first\n");
    const first = driver.run(repository, [
      "create",
      "first",
      "--all",
      "--message",
      "first",
    ]);
    repository.write("second.txt", "second\n");
    const second = driver.run(repository, [
      "create",
      "second",
      "--all",
      "--message",
      "second",
    ]);
    return [first, second];
  });
}

function runNavigationTranscript(driver: CliDriver): CliResult[] {
  return withRepository(driver, (repository) => {
    createLinearStack(repository);
    return [
      driver.run(repository, ["checkout", "first"]),
      driver.run(repository, ["up"]),
      driver.run(repository, ["down"]),
      driver.run(repository, ["top"]),
      driver.run(repository, ["bottom"]),
      driver.run(repository, ["parent"]),
      driver.run(repository, ["children"]),
      driver.run(repository, ["trunk"]),
    ];
  });
}

function runModifyTranscript(driver: CliDriver): CliResult {
  return withRepository(driver, (repository) => {
    createLinearStack(repository);
    requireSuccessfulCommand(driver.run(repository, ["checkout", "first"]));
    repository.write("first.txt", "first updated\n");
    return driver.run(repository, ["modify", "--all"]);
  });
}

function runTrackingTranscript(driver: CliDriver): CliResult[] {
  return withRepository(driver, (repository) => {
    repository.initializeEmpty();
    repository.git(["checkout", "--quiet", "-b", "first"]);
    repository.git([
      "commit",
      "--allow-empty",
      "--quiet",
      "--message",
      "first",
    ]);
    repository.git(["checkout", "--quiet", "-b", "second"]);
    repository.git([
      "commit",
      "--allow-empty",
      "--quiet",
      "--message",
      "second",
    ]);
    const first = driver.run(repository, [
      "track",
      "first",
      "--parent",
      "main",
    ]);
    const second = driver.run(repository, [
      "track",
      "second",
      "--parent",
      "first",
    ]);
    const untrack = driver.run(repository, ["untrack", "first", "--force"]);
    return [first, second, untrack];
  });
}

function runDivergedTrackingTranscript(driver: CliDriver): CliResult {
  return withRepository(driver, (repository) => {
    repository.initializeWithFile();
    repository.git(["checkout", "--quiet", "-b", "feature"]);
    repository.write("feature.txt", "feature\n");
    repository.git(["add", "feature.txt"]);
    repository.git(["commit", "--quiet", "--message", "feature"]);
    repository.git(["checkout", "--quiet", "main"]);
    repository.write("main.txt", "main\n");
    repository.git(["add", "main.txt"]);
    repository.git(["commit", "--quiet", "--message", "main"]);
    repository.git(["checkout", "--quiet", "feature"]);
    return driver.run(repository, ["track", "feature", "--parent", "main"]);
  });
}

function runErrorTranscript(driver: CliDriver): CliResult[] {
  return withRepository(driver, (repository) => {
    repository.git([
      "commit",
      "--allow-empty",
      "--quiet",
      "--message",
      "trunk",
    ]);
    const notInitialized = driver.run(repository, ["restack"]);
    requireSuccessfulCommand(
      driver.run(repository, ["init", "--trunk", "main"]),
    );
    requireSuccessfulCommand(
      driver.run(repository, ["create", "first", "--message", "first"]),
    );
    const duplicate = driver.run(repository, [
      "create",
      "first",
      "--message",
      "first",
    ]);
    const noOperation = driver.run(repository, ["abort", "--force"]);
    return [notInitialized, duplicate, noOperation];
  });
}

function runExtendedNavigationTranscript(driver: CliDriver): CliResult[] {
  return withRepository(driver, (repository) => {
    repository.initializeEmpty();
    repository.git(["checkout", "--quiet", "-b", "first"]);
    repository.git([
      "commit",
      "--allow-empty",
      "--quiet",
      "--message",
      "first",
    ]);
    repository.git(["checkout", "--quiet", "-b", "second"]);
    repository.git([
      "commit",
      "--allow-empty",
      "--quiet",
      "--message",
      "second",
    ]);
    const first = driver.run(repository, ["track", "first", "--force"]);
    const second = driver.run(repository, ["track", "second", "--force"]);
    requireSuccessfulCommand(driver.run(repository, ["checkout", "first"]));
    repository.write("third.txt", "third\n");
    requireSuccessfulCommand(
      driver.run(repository, [
        "create",
        "third",
        "--all",
        "--message",
        "third",
      ]),
    );
    requireSuccessfulCommand(driver.run(repository, ["checkout", "first"]));
    const directedUp = driver.run(repository, ["up", "--to", "second"]);
    return [first, second, directedUp];
  });
}

function runResetTranscript(driver: CliDriver): CliResult[] {
  return withRepository(driver, (repository) => {
    repository.initializeEmpty();
    requireSuccessfulCommand(
      driver.run(repository, ["create", "first", "--message", "first"]),
    );
    const reset = driver.run(repository, ["init", "--reset"]);
    const log = driver.run(repository, ["log", "short"]);
    return [reset, log];
  });
}

function runAliasAndQuietTranscript(driver: CliDriver): CliResult[] {
  return withRepository(driver, (repository) => {
    createLinearStack(repository);
    return [
      driver.run(repository, ["ls"]),
      driver.run(repository, ["log", "short", "--quiet"]),
      driver.run(repository, ["restack", "--upstack", "--quiet"]),
    ];
  });
}

function createLinearStack(repository: ParityRepository): void {
  repository.initializeEmpty();
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
  repository.write("second.txt", "second\n");
  requireSuccessfulCommand(
    repository.driver.run(repository, [
      "create",
      "second",
      "--all",
      "--message",
      "second",
    ]),
  );
}

function withRepository<T>(
  driver: CliDriver,
  scenario: (repository: ParityRepository) => T,
): T {
  const repository = new ParityRepository(driver);
  try {
    return scenario(repository);
  } finally {
    repository.dispose();
  }
}
