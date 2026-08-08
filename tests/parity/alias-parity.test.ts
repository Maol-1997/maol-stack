import { describe, expect, test } from "vitest";

import {
  ParityRepository,
  referenceDriver,
  maolStackDriver,
  type CliDriver,
  type CliResult,
} from "./parity-fixture.js";

const MATCHING_ALIASES = ["r", "sq"];

// The reference CLI rewrote the descriptions behind these aliases to document
// features this CLI deliberately does not implement, so the help text can no
// longer match. See PARITY.md.
const DRIFTED_ALIASES = ["tr", "utr", "s"];

describe("Reference CLI command alias parity", () => {
  test.each(MATCHING_ALIASES)("matches help through the %s alias", (alias) => {
    expect(runAliasHelp(maolStackDriver, alias)).toEqual(
      runAliasHelp(referenceDriver, alias),
    );
  });

  test.skip.each(DRIFTED_ALIASES)(
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
