import type { Argv } from "yargs";

import { type CommandController } from "../../commands/command-controller.js";
import { colors } from "../../output/colors.js";
import {
  confirmRecursiveUntrack,
  selectTrackParent,
} from "../../prompts/mutation-prompts.js";
import {
  determineInteractionMode,
  initializedController,
  type InteractionMode,
} from "../context.js";
import type { CommandArguments, GlobalOptions } from "../parser.js";

type RecursiveTrackRequest = {
  readonly force: boolean;
  readonly interaction: InteractionMode;
};

export function registerTrack(
  parser: Argv<GlobalOptions>,
  rawArguments: readonly string[],
): Argv<GlobalOptions> {
  return parser.command({
    command: ["track [branch]", "tr"],
    describe:
      "Start tracking the current or provided branch by selecting its parent. Can recursively track a stack by specifying each branch's parent interactively.",
    builder: (command) =>
      command
        .positional("branch", { type: "string" })
        .hide("branch")
        .option("parent", {
          alias: "p",
          type: "string",
          description:
            "The tracked branch's parent. Must be set to a tracked branch. If provided, only one branch can be tracked at a time.",
        })
        .option("force", {
          alias: "f",
          type: "boolean",
          description:
            "Sets the parent to the most recent tracked ancestor of the branch being tracked to skip prompts. Takes precedence over --parent",
          default: false,
        }),
    handler: async (args) => track(args, rawArguments),
  });
}

export function registerUntrack(
  parser: Argv<GlobalOptions>,
  rawArguments: readonly string[],
): Argv<GlobalOptions> {
  return parser.command({
    command: ["untrack [branch]", "utr"],
    describe:
      "Stop tracking a branch. If the branch has children, they will also be untracked. Defaults to the current branch.",
    builder: (command) =>
      command
        .positional("branch", { type: "string" })
        .hide("branch")
        .option("force", {
          alias: "f",
          type: "boolean",
          description:
            "Will not prompt for confirmation before untracking a branch with children.",
          default: false,
        }),
    handler: async (args) => untrack(args, rawArguments),
  });
}

async function track(
  args: CommandArguments,
  rawArguments: readonly string[],
): Promise<void> {
  const commandController = initializedController(args);
  const branch =
    typeof args.branch === "string"
      ? args.branch
      : commandController.currentBranch();
  if (args.force) {
    await trackRecursively(commandController, branch, {
      force: true,
      interaction: determineInteractionMode(args, rawArguments),
    });
    return;
  }
  if (typeof args.parent === "string") {
    commandController.track(branch, args.parent);
    return;
  }
  await trackRecursively(commandController, branch, {
    force: false,
    interaction: determineInteractionMode(args, rawArguments),
  });
}

async function trackRecursively(
  commandController: CommandController,
  branch: string,
  request: RecursiveTrackRequest,
): Promise<void> {
  const choices = commandController.trackParentChoices(branch);
  const parent =
    choices.length === 1 ||
    request.force ||
    request.interaction === "non-interactive"
      ? choices[0]
      : await selectTrackParent({ branch, choices });
  if (!parent) {
    commandController.track(branch, undefined, "nearest-ancestor");
    return;
  }
  if (!commandController.isTracked(parent)) {
    await trackRecursively(commandController, parent, request);
  }
  commandController.track(branch, parent, "recursive");
}

async function untrack(
  args: CommandArguments,
  rawArguments: readonly string[],
): Promise<void> {
  const commandController = initializedController(args);
  const branch =
    typeof args.branch === "string"
      ? args.branch
      : commandController.currentBranch();
  if (args.force) {
    commandController.untrack(branch, "force");
    return;
  }
  const children = commandController.untrackChildren(branch);
  if (children.length === 0) {
    commandController.untrack(branch, "confirmed");
    return;
  }
  if (determineInteractionMode(args, rawArguments) === "non-interactive") {
    commandController.untrack(branch, "confirm");
    return;
  }
  process.stdout.write(
    `${colors.yellow(branch)} has tracked children:\n${children.map((child) => `▸ ${child}`).join("\n")}\n`,
  );
  if (await confirmRecursiveUntrack(branch)) {
    commandController.untrack(branch, "confirmed");
  }
}
