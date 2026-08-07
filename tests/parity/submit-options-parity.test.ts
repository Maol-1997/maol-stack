import { describe, expect, test } from "vitest";

import { referenceDriver, stacklineDriver } from "./parity-fixture.js";
import {
  defaultSubmitArgs,
  defaultSubmitScenario,
  runSubmitDryRun,
} from "./submit-scenarios.js";

describe("Reference CLI submit option parity", () => {
  test("matches explicit draft publication", () => {
    const scenario = {
      ...defaultSubmitScenario(),
      args: [...defaultSubmitArgs(), "--draft"],
    };
    expect(runSubmitDryRun(stacklineDriver, scenario)).toEqual(
      runSubmitDryRun(referenceDriver, scenario),
    );
  });

  test("matches explicit ready publication", () => {
    const scenario = {
      ...defaultSubmitScenario(),
      args: [...defaultSubmitArgs(), "--publish"],
    };
    expect(runSubmitDryRun(stacklineDriver, scenario)).toEqual(
      runSubmitDryRun(referenceDriver, scenario),
    );
  });

  test("matches update-only when every pull request is new", () => {
    const scenario = {
      ...defaultSubmitScenario(),
      args: [...defaultSubmitArgs(), "--update-only"],
    };
    expect(runSubmitDryRun(stacklineDriver, scenario)).toEqual(
      runSubmitDryRun(referenceDriver, scenario),
    );
  });

  test("matches the submit-stack alias", () => {
    const scenario = {
      ...defaultSubmitScenario(),
      args: ["ss", "--dry-run", "--no-edit", "--no-interactive"],
    };
    expect(runSubmitDryRun(stacklineDriver, scenario)).toEqual(
      runSubmitDryRun(referenceDriver, scenario),
    );
  });

  test("rejects draft and publish together", () => {
    const scenario = {
      ...defaultSubmitScenario(),
      args: [...defaultSubmitArgs(), "--draft", "--publish"],
    };
    expect(runSubmitDryRun(stacklineDriver, scenario)).toEqual(
      runSubmitDryRun(referenceDriver, scenario),
    );
  });
});
