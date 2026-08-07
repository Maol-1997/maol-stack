import { describe, expect, test } from "vitest";

import {
  ParityRepository,
  referenceDriver,
  stacklineDriver,
  type CliDriver,
} from "./parity-fixture.js";

describe("Reference CLI commit message parity", () => {
  test("matches a multi-paragraph create message", () => {
    expect(runCreateMessage(stacklineDriver)).toEqual(
      runCreateMessage(referenceDriver),
    );
  });

  test("matches a multi-paragraph modify message", () => {
    expect(runModifyMessage(stacklineDriver)).toEqual(
      runModifyMessage(referenceDriver),
    );
  });

  test("matches a multi-paragraph squash message", () => {
    expect(runSquashMessage(stacklineDriver)).toEqual(
      runSquashMessage(referenceDriver),
    );
  });
});

function runCreateMessage(driver: CliDriver): unknown {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    repository.write("first.txt", "first\n");
    const result = driver.run(repository, [
      "create",
      "first",
      "--all",
      "--message",
      "title",
      "--message",
      "body",
    ]);
    return { message: commitMessage(repository, "first"), result };
  } finally {
    repository.dispose();
  }
}

function runModifyMessage(driver: CliDriver): unknown {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createFirstBranch(repository);
    repository.write("first.txt", "first updated\n");
    const result = driver.run(repository, [
      "modify",
      "--all",
      "--message",
      "updated title",
      "--message",
      "updated body",
    ]);
    return { message: commitMessage(repository, "first"), result };
  } finally {
    repository.dispose();
  }
}

function runSquashMessage(driver: CliDriver): unknown {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    createFirstBranch(repository);
    repository.write("second.txt", "second\n");
    repository.git(["add", "second.txt"]);
    repository.git(["commit", "--quiet", "-m", "second"]);
    const result = driver.run(repository, [
      "squash",
      "--message",
      "squashed title",
      "--message",
      "squashed body",
    ]);
    return { message: commitMessage(repository, "first"), result };
  } finally {
    repository.dispose();
  }
}

function createFirstBranch(repository: ParityRepository): void {
  repository.write("first.txt", "first\n");
  const result = repository.driver.run(repository, [
    "create",
    "first",
    "--all",
    "--message",
    "first",
  ]);
  if (result.status !== 0) {
    throw new Error(`${result.stdout}${result.stderr}`);
  }
}

function commitMessage(repository: ParityRepository, branch: string): string {
  return repository.git(["log", "-1", "--format=%B", branch]);
}
