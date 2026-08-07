import { describe, expect, test } from "vitest";

import {
  ParityRepository,
  referenceDriver,
  requireSuccessfulCommand,
  stacklineDriver,
  type CliDriver,
} from "./parity-fixture.js";

describe("Reference CLI detached HEAD parity", () => {
  test("matches reads, mutations, and recovery from detached HEAD", () => {
    expect(runDetachedHeadCommands(stacklineDriver)).toEqual(
      runDetachedHeadCommands(referenceDriver),
    );
  });
});

function runDetachedHeadCommands(driver: CliDriver): unknown {
  const repository = new ParityRepository(driver);
  try {
    repository.initializeEmpty();
    repository.write("first.txt", "first\n");
    requireSuccessfulCommand(
      driver.run(repository, [
        "create",
        "first",
        "--all",
        "--message",
        "first",
      ]),
    );
    repository.git(["checkout", "--detach", "--quiet", "HEAD"]);
    return {
      commands: [
        driver.run(repository, ["log"]),
        driver.run(repository, ["log", "short"]),
        driver.run(repository, ["parent"]),
        driver.run(repository, ["create", "detached", "--message", "detached"]),
        driver.run(repository, ["checkout", "first"]),
      ],
      state: repository.observe(["main", "first"]),
    };
  } finally {
    repository.dispose();
  }
}
