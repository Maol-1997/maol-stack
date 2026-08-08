import type { Argv } from "yargs";

import { selectTrunk } from "../../prompts/mutation-prompts.js";
import { controller, determineInteractionMode } from "../context.js";
import type { CommandArguments, GlobalOptions } from "../parser.js";

export function registerInit(
  parser: Argv<GlobalOptions>,
  rawArguments: readonly string[],
): Argv<GlobalOptions> {
  return parser.command({
    command: "init",
    describe:
      "Initialize maol-stack in this repository by selecting a trunk branch. Can also be used to change the trunk branch.",
    builder: (command) =>
      command
        .option("trunk", {
          type: "string",
          description:
            "The name of your trunk branch. If no name is passed, you will be prompted to select one interactively.",
        })
        .option("reset", {
          type: "boolean",
          description: "Untrack all branches.",
          default: false,
        }),
    handler: async (args) => initialize(args, rawArguments),
  });
}

async function initialize(
  args: CommandArguments,
  rawArguments: readonly string[],
): Promise<void> {
  const commandController = controller(args);
  const mode = args.reset ? "reset" : "preserve";
  commandController.printInitializationPrelude();
  if (typeof args.trunk === "string") {
    commandController.initializeAfterPrelude(args.trunk, mode);
    return;
  }
  const inferredTrunk = commandController.inferredTrunk();
  if (determineInteractionMode(args, rawArguments) === "non-interactive") {
    if (!inferredTrunk) {
      throw new Error(
        "Could not infer trunk branch, pass in an existing branch name with --trunk or run in interactive mode.",
      );
    }
    commandController.initializeAfterPrelude(inferredTrunk, mode);
    return;
  }
  const trunk = await selectTrunk(
    commandController.initializationBranches(),
    inferredTrunk,
  );
  commandController.initializeAfterPrelude(trunk, mode);
}
