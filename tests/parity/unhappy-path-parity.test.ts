import { describe, expect, test } from "vitest";

import {
  ParityRepository,
  referenceDriver,
  requireSuccessfulCommand,
  maolStackDriver,
  type CliDriver,
} from "./parity-fixture.js";

describe("Reference CLI unhappy-path parity", () => {
  test("matches already-tracked, trunk, and missing-branch tracking", () => {
    expect(runTrackingFailures(maolStackDriver)).toEqual(
      runTrackingFailures(referenceDriver),
    );
  });

  test("matches invalid move validation without mutating the stack", () => {
    expect(runInvalidMoves(maolStackDriver)).toEqual(
      runInvalidMoves(referenceDriver),
    );
  });

  test("matches trunk guards and modify target validation", () => {
    expect(runMutationGuards(maolStackDriver)).toEqual(
      runMutationGuards(referenceDriver),
    );
  });

  test("matches invalid create requests", () => {
    expect(runInvalidCreates(maolStackDriver)).toEqual(
      runInvalidCreates(referenceDriver),
    );
  });

  test("matches missing continue, abort, and undo operations", () => {
    expect(runMissingOperations(maolStackDriver)).toEqual(
      runMissingOperations(referenceDriver),
    );
  });

  test("matches modify without staged changes", () => {
    expect(runEmptyModify(maolStackDriver)).toEqual(
      runEmptyModify(referenceDriver),
    );
  });

  test("matches mutations attempted from an untracked branch", () => {
    expect(runUntrackedMutations(maolStackDriver)).toEqual(
      runUntrackedMutations(referenceDriver),
    );
  });

  test("matches missing source and explicit parent validation", () => {
    expect(runMissingBranchOptions(maolStackDriver)).toEqual(
      runMissingBranchOptions(referenceDriver),
    );
  });

  test("matches squash on a tracked branch without commits", () => {
    expect(runEmptyBranchSquash(maolStackDriver)).toEqual(
      runEmptyBranchSquash(referenceDriver),
    );
  });
});

function runTrackingFailures(driver: CliDriver): unknown {
  return withLinearStack(driver, (repository) => ({
    commands: [
      driver.run(repository, ["track", "third"]),
      driver.run(repository, ["track", "main"]),
      driver.run(repository, ["track", "missing"]),
      driver.run(repository, ["untrack", "main"]),
      driver.run(repository, ["untrack", "missing"]),
    ],
    state: repository.observe(stackBranches),
  }));
}

function runInvalidMoves(driver: CliDriver): unknown {
  return withLinearStack(driver, (repository) => {
    requireSuccessfulCommand(driver.run(repository, ["checkout", "second"]));
    const missingParent = driver.run(repository, ["move", "--onto", "missing"]);
    const selfParent = driver.run(repository, ["move", "--onto", "second"]);
    requireSuccessfulCommand(driver.run(repository, ["checkout", "first"]));
    const descendantParent = driver.run(repository, [
      "move",
      "--onto",
      "third",
    ]);
    return {
      commands: [missingParent, selfParent, descendantParent],
      state: repository.observe(stackBranches),
    };
  });
}

function runMutationGuards(driver: CliDriver): unknown {
  return withLinearStack(driver, (repository) => {
    requireSuccessfulCommand(driver.run(repository, ["checkout", "main"]));
    const parent = driver.run(repository, ["parent"]);
    const modify = driver.run(repository, ["modify", "--no-interactive"]);
    const squash = driver.run(repository, ["squash"]);
    requireSuccessfulCommand(driver.run(repository, ["checkout", "third"]));
    const missingTarget = driver.run(repository, [
      "modify",
      "--into",
      "missing",
      "--no-interactive",
    ]);
    const trunkTarget = driver.run(repository, [
      "modify",
      "--into",
      "main",
      "--no-interactive",
    ]);
    return {
      commands: [parent, modify, squash, missingTarget, trunkTarget],
      state: repository.observe(stackBranches),
    };
  });
}

function runInvalidCreates(driver: CliDriver): unknown {
  return withLinearStack(driver, (repository) => ({
    commands: [
      driver.run(repository, ["create", "first", "--message", "duplicate"]),
      driver.run(repository, ["create", "--message", ""]),
      driver.run(repository, ["create", "newbie", "--onto", "missing"]),
    ],
    state: repository.observe(stackBranches),
  }));
}

function runMissingOperations(driver: CliDriver): unknown {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    return {
      commands: [
        driver.run(repository, ["continue"]),
        driver.run(repository, ["abort", "--force"]),
        driver.run(repository, ["undo"]),
      ],
      state: repository.observe(["main"]),
    };
  } finally {
    repository.dispose();
  }
}

function runEmptyModify(driver: CliDriver): unknown {
  return withLinearStack(driver, (repository) => ({
    result: driver.run(repository, ["modify", "--no-interactive"]),
    state: repository.observe(stackBranches),
  }));
}

function runUntrackedMutations(driver: CliDriver): unknown {
  return withLinearStack(driver, (repository) => {
    repository.git(["branch", "loose", "main"]);
    repository.git(["checkout", "--quiet", "loose"]);
    return {
      commands: [
        driver.run(repository, ["modify", "--no-interactive"]),
        driver.run(repository, ["modify", "--interactive-rebase"]),
        driver.run(repository, ["squash"]),
        driver.run(repository, ["restack", "--branch", "loose"]),
        driver.run(repository, ["move", "--source", "loose", "--onto", "main"]),
        driver.run(repository, ["untrack", "loose"]),
      ],
      state: repository.observe([...stackBranches, "loose"]),
    };
  });
}

function runMissingBranchOptions(driver: CliDriver): unknown {
  return withLinearStack(driver, (repository) => {
    repository.git(["branch", "loose", "main"]);
    return {
      commands: [
        driver.run(repository, ["restack", "--branch", "missing"]),
        driver.run(repository, [
          "move",
          "--source",
          "missing",
          "--onto",
          "main",
        ]),
        driver.run(repository, ["track", "loose", "--parent", "missing"]),
      ],
      state: repository.observe([...stackBranches, "loose"]),
    };
  });
}

function runEmptyBranchSquash(driver: CliDriver): unknown {
  return withLinearStack(driver, (repository) => {
    requireSuccessfulCommand(
      driver.run(repository, ["create", "empty", "--message", "empty"]),
    );
    return {
      result: driver.run(repository, ["squash", "--no-edit"]),
      state: repository.observe([...stackBranches, "empty"]),
    };
  });
}

const stackBranches = ["main", "first", "second", "third"] as const;

function withLinearStack<T>(
  driver: CliDriver,
  scenario: (repository: ParityRepository) => T,
): T {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createBranch(repository, "first");
    createBranch(repository, "second");
    createBranch(repository, "third");
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
