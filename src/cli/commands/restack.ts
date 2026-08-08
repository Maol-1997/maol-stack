import type { Argv } from "yargs";

import { brightBlue } from "../../output/colors.js";
import { PromptCancelledError } from "../../prompts/prompt-library.js";
import { confirmAbort } from "../../prompts/mutation-prompts.js";
import type { RestackScope } from "../../stack/restack-service.js";
import {
  determineInteractionMode,
  initializedController,
  requireInteractive,
} from "../context.js";
import type { CommandArguments, GlobalOptions } from "../parser.js";

type RestackOptions = {
  readonly branch?: string;
  readonly downstack?: boolean;
  readonly only?: boolean;
  readonly upstack?: boolean;
};

export function registerRestack(
  parser: Argv<GlobalOptions>,
): Argv<GlobalOptions> {
  return parser.command({
    command: ["restack", "r"],
    describe:
      "Ensure each branch in the current stack has its parent in its Git commit history, rebasing if necessary. If conflicts are encountered, you will be prompted to resolve them via an interactive Git rebase.",
    builder: (command) =>
      command
        .option("branch", {
          type: "string",
          description:
            "Which branch to run this command from. Defaults to the current branch.",
        })
        .option("downstack", {
          alias: "d",
          type: "boolean",
          description: "Only restack this branch and its ancestors.",
          default: false,
        })
        .option("upstack", {
          alias: "u",
          type: "boolean",
          description: "Only restack this branch and its descendants.",
          default: false,
        })
        .option("only", {
          alias: "o",
          type: "boolean",
          description: "Only restack this branch.",
          default: false,
        }),
    handler: (args) => {
      const commandController = initializedController(args);
      commandController.restack({
        branch: args.branch ?? commandController.currentBranch(),
        scope: determineRestackScope(args),
      });
    },
  });
}

export function registerContinue(
  parser: Argv<GlobalOptions>,
): Argv<GlobalOptions> {
  return parser.command({
    command: ["continue", "cont"],
    describe:
      "Continue the most recent maol-stack command halted by a rebase conflict.",
    builder: (command) =>
      command.option("all", {
        alias: "a",
        type: "boolean",
        description: "Stage all changes before continuing.",
        default: false,
      }),
    handler: (args) => {
      if (args.all) {
        initializedController(args).continueWithAllChanges();
      } else {
        initializedController(args).continue();
      }
    },
  });
}

export function registerAbort(
  parser: Argv<GlobalOptions>,
  rawArguments: readonly string[],
): Argv<GlobalOptions> {
  return parser.command({
    command: "abort",
    describe:
      "Abort the current maol-stack command halted by a rebase conflict.",
    builder: (command) =>
      command.option("force", {
        alias: "f",
        type: "boolean",
        description: "Do not prompt for confirmation; abort immediately.",
        default: false,
      }),
    handler: (args) => abort(args, rawArguments),
  });
}

export function registerUndo(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
  return parser.command({
    command: "undo",
    describe: "Undo the most recent maol-stack mutation.",
    builder: (command) =>
      command.option("force", {
        alias: "f",
        type: "boolean",
        description:
          "Do not prompt for confirmation; undo the most recent command immediately.",
        default: false,
      }),
    handler: (args) => initializedController(args).undo(),
  });
}

async function abort(
  args: CommandArguments,
  rawArguments: readonly string[],
): Promise<void> {
  const commandController = initializedController(args);
  const operation = commandController.abortLabel();
  if (!operation || args.force) {
    commandController.abort();
    return;
  }
  requireInteractive(determineInteractionMode(args, rawArguments));
  if (await confirmAbort(operation)) {
    commandController.abort();
    return;
  }
  console.log(brightBlue("🛑 Aborted abort."));
  throw new PromptCancelledError();
}

function determineRestackScope(options: RestackOptions): RestackScope {
  if (options.only) {
    return "only";
  }
  if (options.downstack) {
    return "downstack";
  }
  if (options.upstack) {
    return "upstack";
  }
  return "stack";
}
