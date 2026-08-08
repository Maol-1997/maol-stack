import { describe, expect, test } from "vitest";

import {
  ParityRepository,
  referenceDriver,
  maolStackDriver,
  type CliDriver,
  type CliResult,
} from "./parity-fixture.js";

describe("Reference CLI command alias parity", () => {
  test.each(["tr", "utr", "r", "sq", "s"])(
    "matches help through the %s alias",
    (alias) => {
      expect(runAliasHelp(maolStackDriver, alias)).toEqual(
        runAliasHelp(referenceDriver, alias),
      );
    },
  );
});

function runAliasHelp(driver: CliDriver, alias: string): CliResult {
  const repository = new ParityRepository(driver);
  try {
    return driver.run(repository, [alias, "--help"]);
  } finally {
    repository.dispose();
  }
}
