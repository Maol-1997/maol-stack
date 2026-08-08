import { describe, expect, test } from "vitest";

import {
  ParityRepository,
  referenceDriver,
  requireSuccessfulCommand,
  maolStackDriver,
  type CliDriver,
  type CliResult,
} from "./parity-fixture.js";

describe("Reference CLI abort prompt parity", () => {
  test("matches confirming an interactive abort", () => {
    expect(runAbort(maolStackDriver, "yes")).toEqual(
      runAbort(referenceDriver, "yes"),
    );
  });

  test("matches declining an interactive abort", () => {
    expect(runAbort(maolStackDriver, "no")).toEqual(
      runAbort(referenceDriver, "no"),
    );
  });

  test("matches cancelling an interactive abort at EOF", () => {
    expect(runAbort(maolStackDriver, "eof")).toEqual(
      runAbort(referenceDriver, "eof"),
    );
  });

  test("matches abort without force in non-interactive mode", () => {
    expect(runAbort(maolStackDriver, "non-interactive")).toEqual(
      runAbort(referenceDriver, "non-interactive"),
    );
  });
});

function runAbort(
  driver: CliDriver,
  response: "eof" | "no" | "non-interactive" | "yes",
): unknown {
  const repository = new ParityRepository(driver);
  try {
    createPausedConflict(repository);
    const result = invokeAbort(driver, repository, response);
    return {
      result,
      state: repository.observe(["main", "first"]),
    };
  } finally {
    repository.dispose();
  }
}

function invokeAbort(
  driver: CliDriver,
  repository: ParityRepository,
  response: "eof" | "no" | "non-interactive" | "yes",
): CliResult {
  if (response === "non-interactive") {
    return driver.run(repository, ["abort", "--no-interactive"]);
  }
  const input =
    response === "yes" ? "y\r" : response === "no" ? "\r" : undefined;
  return driver.runInTty(repository, ["abort", "--interactive"], input);
}

function createPausedConflict(repository: ParityRepository): void {
  repository.initializeWithFile();
  repository.write("shared.txt", "feature\n");
  requireSuccessfulCommand(
    repository.driver.run(repository, [
      "create",
      "first",
      "--all",
      "--message",
      "first",
    ]),
  );
  requireSuccessfulCommand(
    repository.driver.run(repository, ["checkout", "main"]),
  );
  repository.write("shared.txt", "trunk\n");
  repository.git(["add", "shared.txt"]);
  repository.git(["commit", "--quiet", "--message", "trunk moves"]);
  requireSuccessfulCommand(
    repository.driver.run(repository, ["checkout", "first"]),
  );
  const restack = repository.driver.run(repository, ["restack"]);
  if (restack.status === 0) {
    throw new Error("expected restack to pause on a conflict");
  }
}
