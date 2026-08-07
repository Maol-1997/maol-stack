import { describe, expect, test } from "vitest";

import { referenceDriver, stacklineDriver } from "./parity-fixture.js";
import { defaultSubmitScenario, runSubmitDryRun } from "./submit-scenarios.js";

describe("Reference CLI submit output parity", () => {
  test("matches a non-interactive dry run for a new stack", () => {
    expect(runSubmitDryRun(stacklineDriver, defaultSubmitScenario())).toEqual(
      runSubmitDryRun(referenceDriver, defaultSubmitScenario()),
    );
  });

  test("matches a dry run whose branches introduce no changes", () => {
    const scenario = {
      ...defaultSubmitScenario(),
      stackContents: "empty",
    } as const;
    expect(runSubmitDryRun(stacklineDriver, scenario)).toEqual(
      runSubmitDryRun(referenceDriver, scenario),
    );
  });
});
