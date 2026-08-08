import { describe, expect, test } from "vitest";

import { referenceDriver, maolStackDriver } from "./parity-fixture.js";
import {
  defaultSubmitArgs,
  defaultSubmitScenario,
  runSubmitDryRun,
} from "./submit-scenarios.js";

describe("Reference CLI submit selection parity", () => {
  test("matches narrow submit through the current branch", () => {
    const scenario = {
      ...defaultSubmitScenario(),
      args: defaultSubmitArgs().filter((argument) => argument !== "--stack"),
    };
    expect(runSubmitDryRun(maolStackDriver, scenario)).toEqual(
      runSubmitDryRun(referenceDriver, scenario),
    );
  });

  test("matches stack submit from an explicit parent branch", () => {
    const scenario = {
      ...defaultSubmitScenario(),
      args: [...defaultSubmitArgs(), "--branch", "parity-first"],
    };
    expect(runSubmitDryRun(maolStackDriver, scenario)).toEqual(
      runSubmitDryRun(referenceDriver, scenario),
    );
  });

  test("skips descendants of an empty parent branch", () => {
    const scenario = {
      ...defaultSubmitScenario(),
      stackContents: "empty-parent",
    } as const;
    expect(runSubmitDryRun(maolStackDriver, scenario)).toEqual(
      runSubmitDryRun(referenceDriver, scenario),
    );
  });
});
