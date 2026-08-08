import { describe, expect, test } from "vitest";

import {
  ParityRepository,
  referenceDriver,
  requireSuccessfulCommand,
  maolStackDriver,
  type CliDriver,
} from "./parity-fixture.js";

describe("Reference CLI create option parity", () => {
  test("matches creating onto an explicit parent", () => {
    expect(runCreateOnto(maolStackDriver)).toEqual(
      runCreateOnto(referenceDriver),
    );
  });

  test("matches inserting a branch before one child", () => {
    expect(runCreateInsert(maolStackDriver)).toEqual(
      runCreateInsert(referenceDriver),
    );
  });

  test("matches an ambiguous non-interactive insert", () => {
    expect(
      normalizeConcurrentRestacks(runAmbiguousInsert(maolStackDriver)),
    ).toEqual(normalizeConcurrentRestacks(runAmbiguousInsert(referenceDriver)));
  });

  test("matches non-interactive patch selection failure", () => {
    expect(runPatchSelection(maolStackDriver)).toEqual(
      runPatchSelection(referenceDriver),
    );
  });
});

function runCreateOnto(driver: CliDriver): unknown {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createBranch(repository, "alpha");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "main"]));
    createBranch(repository, "beta");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "alpha"]));
    repository.write("child.txt", "child\n");
    const result = driver.run(repository, [
      "create",
      "child",
      "--onto",
      "beta",
      "--all",
      "--message",
      "child",
    ]);
    return {
      result,
      state: repository.observe(["main", "alpha", "beta", "child"]),
    };
  } finally {
    repository.dispose();
  }
}

function normalizeConcurrentRestacks(result: unknown): unknown {
  const scenario = result as {
    readonly result: { readonly stdout: string };
  };
  const restackLines = scenario.result.stdout
    .split("\n")
    .filter((line) => line.startsWith("Restacked "))
    .sort();
  const stableOutput = scenario.result.stdout
    .split("\n")
    .filter((line) => !line.startsWith("Restacked "));
  return {
    ...scenario,
    result: {
      ...scenario.result,
      stdout: [...stableOutput.slice(0, -1), ...restackLines, ""].join("\n"),
    },
  };
}

function runCreateInsert(driver: CliDriver): unknown {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createBranch(repository, "first");
    createBranch(repository, "second");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "first"]));
    repository.write("inserted.txt", "inserted\n");
    const result = driver.run(repository, [
      "create",
      "inserted",
      "--insert",
      "--all",
      "--message",
      "inserted",
    ]);
    return {
      result,
      state: repository.observe(["main", "first", "inserted", "second"]),
    };
  } finally {
    repository.dispose();
  }
}

function runAmbiguousInsert(driver: CliDriver): unknown {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createBranch(repository, "first");
    createBranch(repository, "alpha");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "first"]));
    createBranch(repository, "beta");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "first"]));
    repository.write("inserted.txt", "inserted\n");
    const result = driver.run(repository, [
      "create",
      "inserted",
      "--insert",
      "--all",
      "--message",
      "inserted",
      "--no-interactive",
    ]);
    return { result, status: repository.git(["status", "--porcelain=v1"]) };
  } finally {
    repository.dispose();
  }
}

function runPatchSelection(driver: CliDriver): unknown {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeWithFile();
    repository.write("shared.txt", "updated\n");
    return driver.run(repository, [
      "create",
      "patch",
      "--patch",
      "--message",
      "patch",
      "--no-interactive",
    ]);
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
