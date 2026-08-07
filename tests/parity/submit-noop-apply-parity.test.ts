import { describe, expect, test } from "vitest";

import { referenceDriver, stacklineDriver } from "./parity-fixture.js";
import { defaultSubmitScenario, runSubmitDryRun } from "./submit-scenarios.js";

describe.skip("Reference CLI-hosted repository gate for submit apply", () => {
  test("matches update-only when no pull requests exist", () => {
    const scenario = {
      ...defaultSubmitScenario(),
      args: [
        "submit",
        "--stack",
        "--no-edit",
        "--no-interactive",
        "--update-only",
      ],
    };
    expect(runSubmitDryRun(stacklineDriver, scenario)).toEqual(
      runSubmitDryRun(referenceDriver, scenario),
    );
  });

  test("matches applying a stack blocked by empty branches", () => {
    const scenario = {
      ...defaultSubmitScenario(),
      args: ["submit", "--stack", "--no-edit", "--no-interactive"],
      stackContents: "empty",
    } as const;
    expect(runSubmitDryRun(stacklineDriver, scenario)).toEqual(
      runSubmitDryRun(referenceDriver, scenario),
    );
  });
});
