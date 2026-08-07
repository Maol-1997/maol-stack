import { describe, expect, test } from "vitest";

import { referenceDriver, stacklineDriver } from "./parity-fixture.js";
import {
  defaultSubmitArgs,
  defaultSubmitScenario,
  runSubmitDryRun,
} from "./submit-scenarios.js";

describe("Reference CLI advanced submit option parity", () => {
  test("matches metadata and review options during a dry run", () => {
    const scenario = {
      ...defaultSubmitScenario(),
      args: [
        ...defaultSubmitArgs(),
        "--ai",
        "--edit-title",
        "--edit-description",
        "--reviewers",
        "Maol-1997",
        "--team-reviewers",
        "example-team",
        "--merge-when-ready",
        "--rerequest-review",
        "--comment",
        "parity comment",
      ],
    };
    expect(runSubmitDryRun(stacklineDriver, scenario)).toEqual(
      runSubmitDryRun(referenceDriver, scenario),
    );
  });

  test("matches transport and presentation options during a dry run", () => {
    const scenario = {
      ...defaultSubmitScenario(),
      args: [
        ...defaultSubmitArgs(),
        "--confirm",
        "--force",
        "--always",
        "--view",
        "--target-trunk",
        "main",
        "--cli",
      ],
    };
    expect(runSubmitDryRun(stacklineDriver, scenario)).toEqual(
      runSubmitDryRun(referenceDriver, scenario),
    );
  });
});
