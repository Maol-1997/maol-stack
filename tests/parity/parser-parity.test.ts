import { describe, expect, test } from "vitest";

import {
  ParityRepository,
  referenceDriver,
  maolStackDriver,
  type CliDriver,
  type CliResult,
} from "./parity-fixture.js";

describe("Reference CLI parser parity", () => {
  test.each([{ args: [] }, { args: ["--help"] }, { args: ["--bogusflag"] }])(
    "shows independent top-level help for $args",
    ({ args }) => {
      const result = runCommand(maolStackDriver, args);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("maol-stack is a local, independent CLI");
      expect(result.stdout).not.toContain("reference.com");
    },
  );

  test.each([
    "abort",
    "bottom",
    "checkout",
    "children",
    "create",
    "continue",
    "down",
    "init",
    "log",
    "modify",
    "move",
    "parent",
    "restack",
    "state",
    "submit",
    "squash",
    "top",
    "track",
    "trunk",
    "undo",
    "untrack",
    "up",
  ])("shows branded %s command help", (command) => {
    const result = runCommand(maolStackDriver, [command, "--help"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain(`maol-stack ${command}`);
  });

  test("matches an unknown checkout option", () => {
    expect(runCommand(maolStackDriver, ["checkout", "--bogusflag"])).toEqual(
      runCommand(referenceDriver, ["checkout", "--bogusflag"]),
    );
  });

  test.each([
    ["up", "--version"],
    ["log", "--version"],
    ["--debug", "--version"],
  ])("matches global version handling for %s", (...args) => {
    expect(normalizeVersion(runCommand(maolStackDriver, args))).toEqual(
      normalizeVersion(runCommand(referenceDriver, args)),
    );
  });
});

function runCommand(driver: CliDriver, args: readonly string[]): CliResult {
  const repository = new ParityRepository(driver);
  try {
    return driver.run(repository, args);
  } finally {
    repository.dispose();
  }
}

function normalizeVersion(result: CliResult): CliResult {
  return {
    ...result,
    stdout: result.stdout.replace(/^\d+\.\d+\.\d+\n$/, "<version>\n"),
  };
}
