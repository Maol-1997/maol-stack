import type { Argv } from "yargs";

import { selectBranch } from "../../prompts/branch-selector.js";
import {
  determineInteractionMode,
  initializedController,
  requireInteractive,
} from "../context.js";
import type { CommandArguments, GlobalOptions } from "../parser.js";

export function registerCheckout(
  parser: Argv<GlobalOptions>,
  rawArguments: readonly string[],
): Argv<GlobalOptions> {
  return parser.command({
    command: ["checkout [branch]", "co"],
    describe:
      "Switch to a branch. If no branch is provided, opens an interactive selector.",
    builder: (command) =>
      command
        .positional("branch", { type: "string" })
        .hide("branch")
        .option("trunk", {
          alias: "t",
          type: "boolean",
          description: "Checkout the current trunk.",
          default: false,
        })
        .option("show-untracked", {
          alias: "u",
          type: "boolean",
          description: "Include untracked branches in interactive selection.",
        })
        .option("stack", {
          alias: "s",
          type: "boolean",
          description:
            "Only show ancestors and descendants of the current branch in interactive selection.",
          default: false,
        })
        .option("all", {
          alias: "a",
          type: "boolean",
          description:
            "Show branches across all configured trunks in interactive selection.",
        }),
    handler: (args) => checkout(args, rawArguments),
  });
}

export function registerUp(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
  return parser.command({
    command: ["up [steps]", "u"],
    describe:
      "Switch to the child of the current branch. Prompts if ambiguous.",
    builder: (command) =>
      command
        .option("steps", {
          alias: "n",
          type: "number",
          description: "The number of levels to traverse upstack.",
          default: 1,
        })
        .option("to", {
          type: "string",
          description:
            "Target branch to navigate towards. When multiple children exist, selects the path leading to this branch.",
        }),
    handler: (args) =>
      initializedController(args).up(
        parseNavigationSteps(String(args.steps)),
        args.to,
      ),
  });
}

export function registerDown(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
  return parser.command({
    command: ["down [steps]", "d"],
    describe: "Switch to the parent of the current branch.",
    builder: (command) =>
      command.option("steps", {
        alias: "n",
        type: "number",
        description: "The number of levels to traverse downstack.",
        default: 1,
      }),
    handler: (args) =>
      initializedController(args).down(
        parseNavigationSteps(String(args.steps)),
      ),
  });
}

export function registerTop(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
  return parser.command({
    command: ["top", "t"],
    describe:
      "Switch to the tip branch of the current stack. Prompts if ambiguous.",
    handler: (args) => initializedController(args).top(),
  });
}

export function registerBottom(
  parser: Argv<GlobalOptions>,
): Argv<GlobalOptions> {
  return parser.command({
    command: ["bottom", "b"],
    describe: "Switch to the branch closest to trunk in the current stack.",
    handler: (args) => initializedController(args).bottom(),
  });
}

async function checkout(
  args: CommandArguments,
  rawArguments: readonly string[],
): Promise<void> {
  const commandController = initializedController(args);
  if (args.trunk) {
    commandController.checkout(commandController.trunkBranch());
    return;
  }
  if (typeof args.branch === "string") {
    commandController.checkout(args.branch);
    return;
  }
  requireInteractive(determineInteractionMode(args, rawArguments));
  const currentBranch = commandController.currentBranch();
  const branch = await selectBranch({
    currentBranch,
    choices: commandController.checkoutChoices({
      acrossTrunks: Boolean(args.all),
      includeUntracked: Boolean(args.showUntracked),
      scope: args.stack ? "current-stack" : "all",
    }),
  });
  commandController.checkout(branch);
}

function parseNavigationSteps(value: string): number {
  const steps = Number(value);
  return steps > 1 ? steps : 1;
}
