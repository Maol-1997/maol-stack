import { describe, expect, test } from "vitest";

import {
  ParityRepository,
  referenceDriver,
  requireSuccessfulCommand,
  stacklineDriver,
  type CliDriver,
  type CliResult,
} from "./parity-fixture.js";

const PARITY_REMOTE = "https://github.com/Maol-1997/claude-code-statusline.git";

describe("Reference CLI multiple stack parity", () => {
  test("matches logging and navigating sibling stacks", () => {
    expect(runSiblingStackNavigation(stacklineDriver)).toEqual(
      runSiblingStackNavigation(referenceDriver),
    );
  });

  test("submits only the selected sibling stack", () => {
    expect(runSiblingStackSubmit(stacklineDriver)).toEqual(
      runSiblingStackSubmit(referenceDriver),
    );
  });

  test("matches a fork within one stack", () => {
    expect(runForkedStackLog(stacklineDriver)).toEqual(
      runForkedStackLog(referenceDriver),
    );
  });

  test.each([false, true])(
    "matches a detailed fork with reverse=%s",
    (reverse) => {
      expect(runForkedDetailedLog(stacklineDriver, reverse)).toEqual(
        runForkedDetailedLog(referenceDriver, reverse),
      );
    },
  );

  test("matches needs-restack annotations in detailed and short logs", () => {
    expect(runNeedsRestackLogs(stacklineDriver)).toEqual(
      runNeedsRestackLogs(referenceDriver),
    );
  });

  test("matches nested forks within one stack", () => {
    expect(runNestedForkLog(stacklineDriver)).toEqual(
      runNestedForkLog(referenceDriver),
    );
  });

  test.each([false, true])(
    "matches nested detailed forks with reverse=%s",
    (reverse) => {
      expect(runNestedForkDetailedLog(stacklineDriver, reverse)).toEqual(
        runNestedForkDetailedLog(referenceDriver, reverse),
      );
    },
  );

  test("matches serialized state for multiple stacks", () => {
    expect(runMultipleStackState(stacklineDriver)).toEqual(
      runMultipleStackState(referenceDriver),
    );
  });
});

function runSiblingStackNavigation(driver: CliDriver): CliResult[] {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createSiblingStacks(repository);
    requireSuccessfulCommand(driver.run(repository, ["checkout", "main"]));
    const log = driver.run(repository, ["log", "short"]);
    const ambiguousUp = driver.run(repository, ["up", "--no-interactive"]);
    const ambiguousTop = driver.run(repository, ["top", "--no-interactive"]);
    const directedUp = driver.run(repository, ["up", "--to", "alpha-two"]);
    return [log, ambiguousUp, ambiguousTop, directedUp];
  } finally {
    repository.dispose();
  }
}

function runSiblingStackSubmit(driver: CliDriver): CliResult {
  const repository = new ParityRepository(driver, PARITY_REMOTE);
  try {
    requireSuccessfulCommand(
      driver.run(repository, ["init", "--trunk", "main"]),
    );
    createSiblingStacks(repository);
    requireSuccessfulCommand(driver.run(repository, ["checkout", "alpha-one"]));
    return driver.run(repository, [
      "submit",
      "--stack",
      "--dry-run",
      "--no-edit",
      "--no-interactive",
    ]);
  } finally {
    repository.dispose();
  }
}

function runForkedStackLog(driver: CliDriver): CliResult {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createBranch(repository, "shared");
    createBranch(repository, "alpha-tip");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "shared"]));
    createBranch(repository, "beta-tip");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "shared"]));
    return driver.run(repository, ["log", "short"]);
  } finally {
    repository.dispose();
  }
}

function runForkedDetailedLog(driver: CliDriver, reverse: boolean): CliResult {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createBranch(repository, "shared");
    createBranch(repository, "alpha-tip");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "shared"]));
    createBranch(repository, "beta-tip");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "shared"]));
    return driver.run(repository, ["log", ...(reverse ? ["--reverse"] : [])]);
  } finally {
    repository.dispose();
  }
}

function runNeedsRestackLogs(driver: CliDriver): CliResult[] {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createBranch(repository, "first");
    createBranch(repository, "second");
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
    return [
      driver.run(repository, ["log"]),
      driver.run(repository, ["log", "short"]),
    ];
  } finally {
    repository.dispose();
  }
}

function runNestedForkLog(driver: CliDriver): CliResult {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createBranch(repository, "shared");
    createBranch(repository, "alpha-root");
    createBranch(repository, "alpha-one");
    requireSuccessfulCommand(
      driver.run(repository, ["checkout", "alpha-root"]),
    );
    createBranch(repository, "alpha-two");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "shared"]));
    createBranch(repository, "beta-root");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "main"]));
    return driver.run(repository, ["log", "short"]);
  } finally {
    repository.dispose();
  }
}

function runNestedForkDetailedLog(
  driver: CliDriver,
  reverse: boolean,
): CliResult {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createBranch(repository, "shared");
    createBranch(repository, "alpha-root");
    createBranch(repository, "alpha-one");
    requireSuccessfulCommand(
      driver.run(repository, ["checkout", "alpha-root"]),
    );
    createBranch(repository, "alpha-two");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "shared"]));
    createBranch(repository, "beta-root");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "shared"]));
    return driver.run(repository, ["log", ...(reverse ? ["--reverse"] : [])]);
  } finally {
    repository.dispose();
  }
}

function createSiblingStacks(repository: ParityRepository): void {
  createBranch(repository, "alpha-one");
  createBranch(repository, "alpha-two");
  requireSuccessfulCommand(
    repository.driver.run(repository, ["checkout", "main"]),
  );
  createBranch(repository, "beta-one");
  createBranch(repository, "beta-two");
}

function runMultipleStackState(driver: CliDriver): CliResult {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createSiblingStacks(repository);
    return driver.run(repository, ["state"]);
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
