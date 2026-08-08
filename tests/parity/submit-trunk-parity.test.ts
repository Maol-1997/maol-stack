import { describe, expect, test } from "vitest";

import {
  ParityRepository,
  referenceDriver,
  requireSuccessfulCommand,
  maolStackDriver,
  type CliDriver,
} from "./parity-fixture.js";

const PARITY_REMOTE = "https://github.com/Maol-1997/claude-code-statusline.git";

describe("Reference CLI submit trunk parity", () => {
  test("matches a trunk behind its upstream", () => {
    expect(runBehindTrunkSubmit(maolStackDriver, "require-synced")).toEqual(
      runBehindTrunkSubmit(referenceDriver, "require-synced"),
    );
  });

  test("matches the out-of-sync trunk override", () => {
    expect(runBehindTrunkSubmit(maolStackDriver, "ignore")).toEqual(
      runBehindTrunkSubmit(referenceDriver, "ignore"),
    );
  });
});

function runBehindTrunkSubmit(
  driver: CliDriver,
  trunkPolicy: "ignore" | "require-synced",
): unknown {
  const repository = new ParityRepository(driver, PARITY_REMOTE);
  try {
    repository.git(["fetch", "--quiet", "--deepen", "1", "origin", "main"]);
    repository.git(["reset", "--hard", "--quiet", "HEAD^"]);
    requireSuccessfulCommand(
      driver.run(repository, ["init", "--trunk", "main"]),
    );
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
    const override =
      trunkPolicy === "ignore" ? ["--ignore-out-of-sync-trunk"] : [];
    const result = driver.run(repository, [
      "submit",
      "--dry-run",
      "--no-edit",
      "--no-interactive",
      ...override,
    ]);
    return {
      result,
      state: repository.observe(["main", "first"]),
    };
  } finally {
    repository.dispose();
  }
}
