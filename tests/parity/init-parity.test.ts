import { describe, expect, test } from "vitest";

import {
  ParityRepository,
  referenceDriver,
  maolStackDriver,
  type CliDriver,
  type CliResult,
} from "./parity-fixture.js";

describe("Reference CLI init parity", () => {
  test("matches inferred trunk initialization", () => {
    expect(runInferredInit(maolStackDriver)).toEqual(
      runInferredInit(referenceDriver),
    );
  });

  test("matches a non-interactive ambiguous trunk error", () => {
    expect(runAmbiguousInit(maolStackDriver)).toEqual(
      runAmbiguousInit(referenceDriver),
    );
  });
});

function runInferredInit(driver: CliDriver): CliResult {
  const repository = new ParityRepository(driver);
  try {
    repository.git([
      "commit",
      "--allow-empty",
      "--quiet",
      "--message",
      "trunk",
    ]);
    return driver.run(repository, ["init"]);
  } finally {
    repository.dispose();
  }
}

function runAmbiguousInit(driver: CliDriver): CliResult {
  const repository = new ParityRepository(driver);
  try {
    repository.git([
      "commit",
      "--allow-empty",
      "--quiet",
      "--message",
      "trunk",
    ]);
    repository.git(["branch", "develop"]);
    repository.git(["checkout", "--quiet", "-b", "feature"]);
    return driver.run(repository, ["init"]);
  } finally {
    repository.dispose();
  }
}
