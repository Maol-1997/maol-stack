import { describe, expect, test } from "vitest";

import {
  ParityRepository,
  referenceDriver,
  requireSuccessfulCommand,
  maolStackDriver,
  type CliDriver,
  type CliResult,
} from "./parity-fixture.js";

describe("Reference CLI mutation prompt parity", () => {
  test("matches staging selection while creating a branch", () => {
    expect(runInteractiveCreate(maolStackDriver, "\r")).toEqual(
      runInteractiveCreate(referenceDriver, "\r"),
    );
  });

  test("matches aborting create from the staging selector", () => {
    const abort = "\u001B[B\u001B[B\u001B[B\r";
    expect(runInteractiveCreate(maolStackDriver, abort)).toEqual(
      runInteractiveCreate(referenceDriver, abort),
    );
  });

  test("matches creating an empty branch from the staging selector", () => {
    const createEmpty = "\u001B[B\u001B[B\r";
    expect(runInteractiveCreate(maolStackDriver, createEmpty)).toEqual(
      runInteractiveCreate(referenceDriver, createEmpty),
    );
  });

  test("matches staging selection while modifying a branch", () => {
    expect(runInteractiveModify(maolStackDriver)).toEqual(
      runInteractiveModify(referenceDriver),
    );
  });

  test("matches editing only the commit message with no file changes", () => {
    expect(runMessageOnlyModify(maolStackDriver)).toEqual(
      runMessageOnlyModify(referenceDriver),
    );
  });

  test("matches selecting children for an inserted branch", () => {
    expect(runInteractiveInsert(maolStackDriver)).toEqual(
      runInteractiveInsert(referenceDriver),
    );
  });

  test("matches default child selection when inserting above a change", () => {
    expect(runInteractiveInsertAboveChange(maolStackDriver)).toEqual(
      runInteractiveInsertAboveChange(referenceDriver),
    );
  });
});

function runInteractiveCreate(driver: CliDriver, input: string): CliResult {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    repository.write("new.txt", "new\n");
    return driver.runInTty(
      repository,
      ["create", "feature", "--message", "feature", "--interactive"],
      input,
    );
  } finally {
    repository.dispose();
  }
}

function runInteractiveModify(driver: CliDriver): CliResult {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createBranch(repository, "feature");
    repository.write("feature.txt", "updated\n");
    return driver.runInTty(repository, ["modify", "--interactive"], "\r");
  } finally {
    repository.dispose();
  }
}

function runInteractiveInsert(driver: CliDriver): CliResult {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createBranch(repository, "alpha");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "main"]));
    createBranch(repository, "beta");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "main"]));
    return driver.runInTty(
      repository,
      [
        "create",
        "inserted",
        "--insert",
        "--message",
        "inserted",
        "--interactive",
      ],
      " \r",
    );
  } finally {
    repository.dispose();
  }
}

function runMessageOnlyModify(driver: CliDriver): CliResult {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createBranch(repository, "feature");
    return driver.runInTty(
      repository,
      ["modify", "--interactive"],
      "\u001B[B\r",
    );
  } finally {
    repository.dispose();
  }
}

function runInteractiveInsertAboveChange(driver: CliDriver): CliResult {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createBranch(repository, "alpha");
    createBranch(repository, "beta");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "alpha"]));
    createBranch(repository, "gamma");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "alpha"]));
    return driver.runInTty(
      repository,
      [
        "create",
        "inserted",
        "--insert",
        "--message",
        "inserted",
        "--interactive",
      ],
      "\r",
    );
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
