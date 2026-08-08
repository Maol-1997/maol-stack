import { describe, expect, test } from "vitest";

import {
  ParityRepository,
  referenceDriver,
  maolStackDriver,
  type CliDriver,
  type CliResult,
} from "./parity-fixture.js";

describe("Reference CLI init prompt parity", () => {
  test("matches selecting a trunk other than the inferred branch", () => {
    expect(runInteractiveInit(maolStackDriver)).toEqual(
      runInteractiveInit(referenceDriver),
    );
  });
});

function runInteractiveInit(driver: CliDriver): CliResult {
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
    repository.git([
      "commit",
      "--allow-empty",
      "--quiet",
      "--message",
      "feature",
    ]);
    return driver.runInTty(repository, ["init", "--interactive"], "\u001B[B\r");
  } finally {
    repository.dispose();
  }
}
