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

describe("Reference CLI submit metadata prompt parity", () => {
  test("matches cancelling metadata entry at EOF", () => {
    expect(runInteractiveMetadata(stacklineDriver)).toEqual(
      runInteractiveMetadata(referenceDriver),
    );
  });
});

function runInteractiveMetadata(driver: CliDriver): CliResult {
  const repository = new ParityRepository(driver, PARITY_REMOTE);
  try {
    requireSuccessfulCommand(
      driver.run(repository, ["init", "--trunk", "main"]),
    );
    repository.write("metadata-parity.txt", "metadata\n");
    requireSuccessfulCommand(
      driver.run(repository, [
        "create",
        "metadata-parity",
        "--all",
        "--message",
        "metadata parity",
      ]),
    );
    return driver.runInTty(repository, [
      "submit",
      "--dry-run",
      "--interactive",
    ]);
  } finally {
    repository.dispose();
  }
}
