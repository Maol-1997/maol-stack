import { describe, expect, test } from "vitest";

import {
  ParityRepository,
  referenceDriver,
  requireSuccessfulCommand,
  stacklineDriver,
  type CliDriver,
} from "./parity-fixture.js";

describe("Reference CLI multiple trunk parity", () => {
  test("matches adding and listing an additional trunk", () => {
    expect(runAdditionalTrunkScenario(stacklineDriver)).toEqual(
      runAdditionalTrunkScenario(referenceDriver),
    );
  });

  test("matches independent stacks rooted at different trunks", () => {
    expect(runIndependentTrunkStacks(stacklineDriver)).toEqual(
      runIndependentTrunkStacks(referenceDriver),
    );
  });

  test("matches interactive checkout across all trunks", () => {
    expect(runAllTrunkCheckout(stacklineDriver)).toEqual(
      runAllTrunkCheckout(referenceDriver),
    );
  });

  test("matches additional trunk validation errors", () => {
    expect(runAdditionalTrunkErrors(stacklineDriver)).toEqual(
      runAdditionalTrunkErrors(referenceDriver),
    );
  });

  test("matches moving a stack across trunks interactively", () => {
    expect(runAllTrunkMove(stacklineDriver)).toEqual(
      runAllTrunkMove(referenceDriver),
    );
  });
});

function runAdditionalTrunkScenario(driver: CliDriver): unknown {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    repository.git(["branch", "release"]);
    return [
      driver.run(repository, ["trunk", "--all"]),
      driver.run(repository, ["trunk", "--add", "release"]),
      driver.run(repository, ["trunk", "--all"]),
      driver.run(repository, ["checkout", "release"]),
      driver.run(repository, ["trunk"]),
      driver.run(repository, ["state"]),
    ];
  } finally {
    repository.dispose();
  }
}

function runIndependentTrunkStacks(driver: CliDriver): unknown {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    repository.git(["branch", "release"]);
    requireSuccessfulCommand(
      driver.run(repository, ["trunk", "--add", "release"]),
    );
    requireSuccessfulCommand(driver.run(repository, ["checkout", "release"]));
    createBranch(repository, "release-first");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "main"]));
    createBranch(repository, "main-first");
    return [
      driver.run(repository, ["state"]),
      driver.run(repository, ["log", "short", "--all"]),
      driver.run(repository, ["log", "--all"]),
      driver.run(repository, ["checkout", "release-first"]),
      driver.run(repository, ["trunk"]),
      driver.run(repository, ["parent"]),
      driver.run(repository, ["bottom"]),
    ];
  } finally {
    repository.dispose();
  }
}

function runAllTrunkCheckout(driver: CliDriver): unknown {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    repository.git(["branch", "release"]);
    requireSuccessfulCommand(
      driver.run(repository, ["trunk", "--add", "release"]),
    );
    requireSuccessfulCommand(driver.run(repository, ["checkout", "release"]));
    createBranch(repository, "release-first");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "main"]));
    createBranch(repository, "main-first");
    return driver.runInTty(
      repository,
      ["checkout", "--all", "--interactive"],
      "release-first\r",
    );
  } finally {
    repository.dispose();
  }
}

function runAdditionalTrunkErrors(driver: CliDriver): unknown {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    repository.git(["branch", "release"]);
    requireSuccessfulCommand(
      driver.run(repository, ["trunk", "--add", "release"]),
    );
    return [
      driver.run(repository, ["trunk", "--add", "release"]),
      driver.run(repository, ["trunk", "--add", "main"]),
      driver.run(repository, ["trunk", "--add", "missing"]),
    ];
  } finally {
    repository.dispose();
  }
}

function runAllTrunkMove(driver: CliDriver): unknown {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    repository.git(["branch", "release"]);
    requireSuccessfulCommand(
      driver.run(repository, ["trunk", "--add", "release"]),
    );
    requireSuccessfulCommand(driver.run(repository, ["checkout", "release"]));
    createBranch(repository, "release-first");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "main"]));
    createBranch(repository, "main-first");
    const result = driver.runInTty(
      repository,
      ["move", "--all", "--interactive"],
      "\u001B[B\u001B[B\r",
    );
    return {
      result,
      state: repository.observe([
        "main",
        "main-first",
        "release",
        "release-first",
      ]),
      trunk: driver.run(repository, ["trunk"]),
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
