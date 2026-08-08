#!/usr/bin/env node

import {
  expandDefaultAliases,
  shouldShowTopLevelHelp,
} from "./cli/arguments.js";
import {
  createParser,
  HelpShownError,
  ParserFailureError,
  TOP_LEVEL_HELP,
} from "./cli/parser.js";
import { brightRed } from "./output/colors.js";
import { PromptCancelledError } from "./prompts/prompt-library.js";
import { RestackConflictError } from "./stack/restack-service.js";
import { STACKLINE_VERSION } from "./version.js";

const rawArguments = expandDefaultAliases(process.argv.slice(2));

if (rawArguments.includes("--version")) {
  process.stdout.write(`${STACKLINE_VERSION}\n`);
} else if (shouldShowTopLevelHelp(rawArguments)) {
  process.stdout.write(`${TOP_LEVEL_HELP}\n`);
} else {
  await runCli(rawArguments);
}

async function runCli(args: readonly string[]): Promise<void> {
  const parser = createParser(args);
  try {
    await parser.parseAsync([...args]);
  } catch (error) {
    handleFailure(error);
  }
}

function handleFailure(error: unknown): void {
  if (
    error instanceof HelpShownError ||
    error instanceof ParserFailureError ||
    error instanceof PromptCancelledError
  ) {
    if (
      error instanceof ParserFailureError ||
      error instanceof PromptCancelledError
    ) {
      process.exitCode = 1;
    }
    return;
  }
  if (!(error instanceof RestackConflictError)) {
    const message = error instanceof Error ? error.message : String(error);
    const output = `ERROR: ${message} `;
    process.stderr.write(
      `${output
        .split("\n")
        .map((line) => brightRed(line))
        .join("\n")}\n`,
    );
  }
  process.exitCode = 1;
}
