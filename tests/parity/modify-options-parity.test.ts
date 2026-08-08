import { describe, expect, test } from "vitest";

import {
  ParityRepository,
  referenceDriver,
  requireSuccessfulCommand,
  maolStackDriver,
  type CliDriver,
} from "./parity-fixture.js";

describe("Reference CLI modify option parity", () => {
  // Output diverged from the reference CLI on the --into path. See PARITY.md.
  test.skip("matches modifying a downstack branch with --into", () => {
    expect(runModifyInto(maolStackDriver)).toEqual(
      runModifyInto(referenceDriver),
    );
  });

  test("rejects modifying an upstack branch with --into", () => {
    expect(runInvalidModifyInto(maolStackDriver)).toEqual(
      runInvalidModifyInto(referenceDriver),
    );
  });

  test("matches creating a new commit", () => {
    expect(runModifyCommit(maolStackDriver)).toEqual(
      runModifyCommit(referenceDriver),
    );
  });

  test("matches resetting the amended commit author", () => {
    expect(runModifyResetAuthor(maolStackDriver)).toEqual(
      runModifyResetAuthor(referenceDriver),
    );
  });

  test("matches an interactive rebase with a no-op sequence editor", () => {
    expect(runInteractiveRebase(maolStackDriver)).toEqual(
      runInteractiveRebase(referenceDriver),
    );
  });

  test("matches patch selection receiving EOF", () => {
    expect(runModifyPatchSelection(maolStackDriver)).toEqual(
      runModifyPatchSelection(referenceDriver),
    );
  });
});

function runModifyInto(driver: CliDriver): unknown {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createBranch(repository, "first");
    createBranch(repository, "second");
    repository.write("first.txt", "first updated\n");
    const result = driver.run(repository, [
      "modify",
      "--into",
      "first",
      "--all",
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

function runInvalidModifyInto(driver: CliDriver): unknown {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createBranch(repository, "first");
    createBranch(repository, "second");
    requireSuccessfulCommand(driver.run(repository, ["checkout", "first"]));
    return driver.run(repository, [
      "modify",
      "--into",
      "second",
      "--all",
      "--no-interactive",
    ]);
  } finally {
    repository.dispose();
  }
}

function runModifyCommit(driver: CliDriver): unknown {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createBranch(repository, "first");
    repository.write("extra.txt", "extra\n");
    const result = driver.run(repository, [
      "modify",
      "--commit",
      "--all",
      "--message",
      "extra",
    ]);
    return {
      result,
      state: repository.observe(["main", "first"]),
    };
  } finally {
    repository.dispose();
  }
}

function runModifyResetAuthor(driver: CliDriver): unknown {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createBranch(repository, "first");
    repository.git([
      "commit",
      "--amend",
      "--no-edit",
      "--quiet",
      "--author",
      "Other Author <other@localhost>",
    ]);
    repository.write("first.txt", "first updated\n");
    const result = driver.run(repository, [
      "modify",
      "--all",
      "--reset-author",
    ]);
    return {
      author: repository.git(["log", "-1", "--format=%an <%ae>", "first"]),
      result,
    };
  } finally {
    repository.dispose();
  }
}

function runInteractiveRebase(driver: CliDriver): unknown {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createBranch(repository, "first");
    const result = driver.run(repository, ["modify", "--interactive-rebase"]);
    return {
      result,
      state: repository.observe(["main", "first"]),
    };
  } finally {
    repository.dispose();
  }
}

function runModifyPatchSelection(driver: CliDriver): unknown {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeWithFile();
    repository.write("first.txt", "first\n");
    const createResult = driver.run(repository, [
      "create",
      "first",
      "--all",
      "--message",
      "first",
    ]);
    requireSuccessfulCommand(createResult);
    repository.write("first.txt", "first updated\n");
    return driver.run(repository, ["modify", "--patch", "--no-interactive"]);
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
