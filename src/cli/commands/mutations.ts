import type { Argv } from "yargs";

import {
  type CommandController,
  type CreateRequest,
  type ModifyRequest,
  type MoveRequest,
} from "../../commands/command-controller.js";
import { selectMoveParent } from "../../prompts/branch-selector.js";
import { selectInsertChildren } from "../../prompts/mutation-prompts.js";
import {
  determineInteractionMode,
  initializedController,
  requireInteractive,
  type InteractionMode,
} from "../context.js";
import type { GlobalOptions } from "../parser.js";
import { resolveCreateStaging, resolveModifyStaging } from "../staging.js";

type MoveSelection = {
  readonly acrossTrunks: boolean;
  readonly interactionMode: InteractionMode;
};

export function registerCreate(
  parser: Argv<GlobalOptions>,
  rawArguments: readonly string[],
): Argv<GlobalOptions> {
  return parser.command({
    command: ["create [name]", "c"],
    describe:
      "Create a new branch stacked on top of the current branch and commit staged changes. If no branch name is specified, generate a branch name from the commit message. If your working directory contains no changes, an empty branch will be created. If you have any unstaged changes, you will be asked whether you'd like to stage them.",
    builder: (command) =>
      command
        .positional("name", { type: "string" })
        .hide("name")
        .option("message", {
          alias: "m",
          type: "string",
          array: true,
          description: "Specify a commit message.",
        })
        .option("all", {
          alias: "a",
          type: "boolean",
          description:
            "Stage all unstaged changes before creating the branch, including to untracked files.",
          default: false,
        })
        .option("update", {
          alias: "u",
          type: "boolean",
          description:
            "Stage all updates to tracked files before creating the branch.",
          default: false,
        })
        .option("patch", {
          alias: "p",
          type: "boolean",
          description: "Pick hunks to stage before committing.",
          default: false,
        })
        .option("insert", {
          alias: "i",
          type: "boolean",
          description:
            "Insert this branch between the current branch and its child. If there are multiple children, prompts you to select which should be moved onto the new branch.",
          default: false,
        })
        .option("ai", {
          type: "boolean",
          description:
            "Automatically AI-generate the branch name and the commit message (if unset)",
          default: false,
        })
        .option("no-ai", {
          type: "boolean",
          description:
            "Do not automatically AI-generate the branch name and the commit message. Takes precedence over --ai.",
          default: false,
        })
        .option("onto", {
          alias: "o",
          type: "string",
          description:
            "Create the branch on top of the specified branch instead of the current branch.",
        })
        .option("verbose", {
          alias: "v",
          type: "count",
          description:
            "Show unified diff between the HEAD commit and what would be committed at the bottom of the commit message template. If specified twice, show in addition the unified diff between what would be committed and the worktree files, i.e. the unstaged changes to tracked files.",
        }),
    handler: async (args) => {
      const commandController = initializedController(args);
      const interactionMode = determineInteractionMode(args, rawArguments);
      let request: CreateRequest = {
        name: args.name,
        message: joinMessageParagraphs(args.message),
        parent: args.onto,
        placement: args.insert ? "insert" : "child",
        stageMode: args.patch
          ? "patch"
          : args.all
            ? "all"
            : args.update
              ? "updates"
              : "staged",
      };
      request = await resolveCreateStaging(
        request,
        commandController,
        interactionMode,
      );
      const parent = request.parent ?? commandController.currentBranch();
      const possibleChildren = args.insert
        ? commandController.trackedChildren(parent)
        : [];
      const promptForChildren =
        possibleChildren.length > 1 && interactionMode === "interactive";
      commandController.create({
        ...request,
        placement: promptForChildren ? "child" : request.placement,
      });
      if (promptForChildren) {
        const newBranch = commandController.currentBranch();
        process.stdout.write("\n");
        const selectedChildren = await selectInsertChildren(
          possibleChildren,
          newBranch,
          !commandController.isTrunk(parent),
        );
        commandController.insertChildren(parent, newBranch, selectedChildren);
      }
    },
  });
}

export function registerModify(
  parser: Argv<GlobalOptions>,
  rawArguments: readonly string[],
): Argv<GlobalOptions> {
  return parser.command({
    command: ["modify", "m"],
    describe:
      "Modify the current branch by amending its commit or creating a new commit. Automatically restacks descendants. If you have any unstaged changes, you will be asked whether you'd like to stage them.",
    builder: (command) =>
      command
        .option("commit", {
          alias: "c",
          type: "boolean",
          description:
            "Create a new commit instead of amending the current commit. If this branch has no commits, this command always creates a new commit.",
          default: false,
        })
        .option("verbose", {
          alias: "v",
          type: "count",
          description:
            "Show unified diff between the HEAD commit and what would be committed at the bottom of the commit message template. If specified twice, show in addition the unified diff between what would be committed and the worktree files, i.e. the unstaged changes to tracked files.",
        })
        .option("all", {
          alias: "a",
          type: "boolean",
          description: "Stage all changes before committing.",
          default: false,
        })
        .option("update", {
          alias: "u",
          type: "boolean",
          description: "Stage all updates to tracked files before committing.",
          default: false,
        })
        .option("patch", {
          alias: "p",
          type: "boolean",
          description: "Pick hunks to stage before committing.",
          default: false,
        })
        .option("edit", {
          alias: "e",
          type: "boolean",
          description:
            "If passed, open an editor to edit the commit message. When creating a new commit, this flag is ignored.",
          default: false,
        })
        .option("message", {
          alias: "m",
          type: "string",
          array: true,
          description:
            "The message for the new or amended commit. If passed, no editor is opened.",
        })
        .option("interactive-rebase", {
          type: "boolean",
          description:
            "Ignore all other flags and start a git interactive rebase on the commits in this branch.",
          default: false,
        })
        .option("reset-author", {
          type: "boolean",
          description:
            "Set the author of the commit to the current user if amending.",
          default: false,
        })
        .option("into", {
          type: "string",
          description:
            "The branch to modify instead of the current branch. Must be downstack in the current stack.",
        }),
    handler: async (args) => {
      const commandController = initializedController(args);
      if (args.interactiveRebase) {
        commandController.interactiveRebase();
        return;
      }
      let request: ModifyRequest = {
        authorPolicy: args.resetAuthor ? "reset" : "preserve",
        editMessage: Boolean(args.edit),
        message: joinMessageParagraphs(args.message),
        commitMode: args.commit ? "new" : "amend",
        stageMode: args.patch
          ? "patch"
          : args.all
            ? "all"
            : args.update
              ? "updates"
              : "staged",
        target: args.into,
      };
      request = await resolveModifyStaging(
        request,
        commandController,
        determineInteractionMode(args, rawArguments),
      );
      commandController.modify(request);
    },
  });
}

export function registerMove(
  parser: Argv<GlobalOptions>,
  rawArguments: readonly string[],
): Argv<GlobalOptions> {
  return parser.command({
    command: "move",
    describe:
      "Rebase the current branch onto the target branch and restack all of its descendants. Use --only to move just the selected branch and leave its descendants behind. If no branch is passed in, opens an interactive selector.",
    builder: (command) =>
      command
        .option("onto", {
          alias: "o",
          type: "string",
          description: "Branch to move the current branch onto.",
        })
        .option("source", {
          alias: "s",
          type: "string",
          description: "Branch to move (defaults to current branch).",
        })
        .option("all", {
          alias: "a",
          type: "boolean",
          description:
            "Show branches across all configured trunks in interactive selection.",
        })
        .option("only", {
          type: "boolean",
          description:
            "Only move this branch. Its descendants stay on the previous parent.",
          default: false,
        }),
    handler: async (args) => {
      const commandController = initializedController(args);
      const branch =
        typeof args.source === "string"
          ? args.source
          : commandController.currentBranch();
      const parent =
        typeof args.onto === "string"
          ? args.onto
          : await selectMoveTarget(commandController, branch, {
              acrossTrunks: Boolean(args.all),
              interactionMode: determineInteractionMode(args, rawArguments),
            });
      const request: MoveRequest = {
        branch,
        parent,
        scope: args.only ? "branch-only" : "with-descendants",
      };
      commandController.move(request);
    },
  });
}

export function registerSquash(
  parser: Argv<GlobalOptions>,
): Argv<GlobalOptions> {
  return parser.command({
    command: ["squash", "sq"],
    describe:
      "Squash all commits in the current branch into a single commit and restack upstack branches.",
    builder: (command) =>
      command
        .option("message", {
          alias: "m",
          type: "string",
          array: true,
          description: "The updated message for the commit.",
        })
        .option("edit", {
          type: "boolean",
          description: "Modify the existing commit message.",
          default: true,
        })
        .option("no-edit", {
          alias: "n",
          type: "boolean",
          description:
            "Don't modify the existing commit message. Takes precedence over --edit",
          default: false,
        }),
    handler: (args) =>
      initializedController(args).squash(joinMessageParagraphs(args.message)),
  });
}

async function selectMoveTarget(
  commandController: CommandController,
  branch: string,
  selection: MoveSelection,
): Promise<string> {
  requireInteractive(selection.interactionMode);
  return selectMoveParent({
    branch,
    choices: commandController.moveChoices(
      branch,
      selection.acrossTrunks ? "all-trunks" : "active-trunk",
    ),
  });
}

function joinMessageParagraphs(
  paragraphs: readonly string[] | undefined,
): string | undefined {
  return paragraphs && paragraphs.length > 0
    ? paragraphs.join("\n\n")
    : undefined;
}
