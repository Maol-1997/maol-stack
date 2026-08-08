import { describe, expect, test } from "vitest";

import { referenceDriver, maolStackDriver } from "./parity-fixture.js";
import { defaultSubmitScenario, runSubmitDryRun } from "./submit-scenarios.js";

describe("Reference CLI submit output parity", () => {
  test("matches a non-interactive dry run for a new stack", () => {
    expect(runSubmitDryRun(maolStackDriver, defaultSubmitScenario())).toEqual(
      runSubmitDryRun(referenceDriver, defaultSubmitScenario()),
    );
  });

  test("matches a dry run whose branches introduce no changes", () => {
    const scenario = {
      ...defaultSubmitScenario(),
      stackContents: "empty",
    } as const;
    expect(runSubmitDryRun(maolStackDriver, scenario)).toEqual(
      runSubmitDryRun(referenceDriver, scenario),
    );
  });
});
