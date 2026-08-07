#!/usr/bin/env node

import { resolve } from "node:path";

import yargs, { type ArgumentsCamelCase, type Argv } from "yargs";

import {
  CommandController,
  type CreateRequest,
  type LogRequest,
  type ModifyRequest,
  type MoveRequest,
} from "./commands/command-controller.js";
import { GitRepository } from "./git/git-repository.js";
import { MetadataStore } from "./metadata/metadata-store.js";
import { brightBlue, brightRed, colors } from "./output/colors.js";
import { startMcpServer } from "./mcp/mcp-server.js";
import {
  PromptCancelledError,
  selectBranch,
  selectMoveParent,
} from "./prompts/branch-selector.js";
import {
  confirmAbort,
  confirmRecursiveUntrack,
  selectInsertChildren,
  selectStagingAction,
  selectTrackParent,
  selectTrunk,
  type StagingAction,
} from "./prompts/mutation-prompts.js";
import {
  RestackConflictError,
  type RestackScope,
} from "./stack/restack-service.js";
import type { SubmitRequest } from "./submit/submit-service.js";
import { STACKLINE_VERSION } from "./version.js";

const HELP_WRAP_MARGIN = 2;
const MAX_HELP_WIDTH = 110;
const TOP_LEVEL_HELP = `maol-stack is a local, independent CLI for stacked GitHub pull requests.
It keeps changes small, focused, and reviewable with local Git metadata and
direct GitHub integration.

USAGE
  $ maol-stack <command> [flags]

AUTHENTICATING
  Submitting pull requests uses the GitHub CLI. Authenticate once with:
  $ gh auth login

TERMS
  stack:     A sequence of pull requests, each building off of its parent.
             ex: main <- PR "add API" <- PR "update frontend" <- PR "docs"
  trunk:     The branch that stacks are merged into.
             ex: main
  downstack: The PRs below the given PR in a stack, i.e. its ancestors.
  upstack:   The PRs above the given PR in a stack, i.e. its descendants.

CORE COMMANDS
  maol-stack init:            Initializes stacked-branch metadata
  maol-stack create:          Creates a branch and commits your changes
  maol-stack submit:          Submits the current branch and its ancestors
  maol-stack submit --stack:  Submits the complete current stack to GitHub
  maol-stack modify:          Amends a branch and restacks its descendants
  maol-stack restack:         Rebases branches onto their recorded parents
  maol-stack checkout:        Interactively checks out a branch
  maol-stack log:             Prints the current stack graph
  maol-stack up:              Checks out the branch directly upstack
  maol-stack down:            Checks out the branch directly downstack

  Pass --help to any command for its complete options.

CORE WORKFLOW
  1. maol-stack init --trunk main
  2. maol-stack create feature-part-1 --all --message "feature: part 1"
  3. maol-stack create feature-part-2 --all --message "feature: part 2"
  4. maol-stack submit --stack`;

type GlobalOptions = {
  readonly cwd?: string;
  readonly debug: boolean;
  readonly help: boolean;
  readonly interactive: boolean;
  readonly quiet: boolean;
  readonly verify: boolean;
};

type CommandArguments = ArgumentsCamelCase<
  GlobalOptions & Record<string, unknown>
>;

type RestackOptions = {
  readonly branch?: string;
  readonly downstack?: boolean;
  readonly only?: boolean;
  readonly upstack?: boolean;
};

type RecursiveTrackRequest = {
  readonly force: boolean;
  readonly interaction: "interactive" | "non-interactive";
};

class HelpShownError extends Error {}
class ParserFailureError extends Error {}

const rawArguments = expandDefaultAliases(process.argv.slice(2));
let activeParser: Argv<GlobalOptions> | undefined;

if (rawArguments.includes("--version")) {
  process.stdout.write(`${STACKLINE_VERSION}\n`);
} else if (shouldShowTopLevelHelp(rawArguments)) {
  process.stdout.write(`${TOP_LEVEL_HELP}\n`);
} else {
  await runCli(rawArguments);
}

async function runCli(args: readonly string[]): Promise<void> {
  const parser = createParser();
  activeParser = parser;
  try {
    await parser.parseAsync([...args]);
  } catch (error) {
    handleFailure(error);
  }
}

function createParser(): Argv<GlobalOptions> {
  const terminalWidth = yargs().terminalWidth();
  const wrapWidth = terminalWidth
    ? Math.min(terminalWidth - HELP_WRAP_MARGIN, MAX_HELP_WIDTH)
    : MAX_HELP_WIDTH;
  let parser: Argv<GlobalOptions> = yargs()
    .scriptName("maol-stack")
    .usage("maol-stack makes working with stacked changes fast and intuitive.")
    .exitProcess(false)
    .help(false)
    .version(false)
    .options({
      cwd: {
        type: "string",
        description: "Working directory in which to perform operations.",
      },
      debug: {
        type: "boolean",
        description: "Write debug output to the terminal.",
        default: false,
      },
      interactive: {
        type: "boolean",
        description:
          "Enable interactive features like prompts, pagers, and editors. Enabled by default. Disable with `--no-interactive`.",
        default: false,
      },
      verify: {
        type: "boolean",
        description:
          "Enable git hooks. Enabled by default. Disable with `--no-verify`.",
        default: true,
      },
      quiet: {
        alias: "q",
        type: "boolean",
        description:
          "Minimize output to the terminal. Implies `--no-interactive`.",
        default: false,
      },
      help: {
        type: "boolean",
        description: "Show help for a command.",
        default: false,
      },
    })
    .group(
      ["cwd", "debug", "interactive", "verify", "quiet"],
      "Global options:",
    )
    .middleware(handleGlobalOptions, true)
    .demandCommand()
    .strict()
    .wrap(wrapWidth)
    .fail((message, error, currentParser) => {
      if (error) {
        throw error;
      }
      currentParser.showHelp("error");
      process.stderr.write(`\n${message}\n`);
      throw new ParserFailureError(message);
    });

  for (const registerCommand of commandRegistrations()) {
    parser = registerCommand(parser);
  }
  return parser;
}

function commandRegistrations(): Array<
  (parser: Argv<GlobalOptions>) => Argv<GlobalOptions>
> {
  return [
    registerAbort,
    registerAdd,
    registerBottom,
    registerCheckout,
    registerChildren,
    registerContinue,
    registerCreate,
    registerDown,
    registerInit,
    registerLog,
    registerMcp,
    registerModify,
    registerMove,
    registerParent,
    registerRestack,
    registerSquash,
    registerState,
    registerSubmit,
    registerTop,
    registerTrack,
    registerTrunk,
    registerUndo,
    registerUntrack,
    registerUp,
  ];
}

function registerInit(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
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
    handler: async (args) => initialize(args),
  });
}

function registerTrack(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
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
    handler: async (args) => track(args),
  });
}

function registerUntrack(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
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
    handler: async (args) => untrack(args),
  });
}

function registerCreate(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
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
      request = await resolveCreateStaging(request, commandController, args);
      const parent = request.parent ?? commandController.currentBranch();
      const possibleChildren = args.insert
        ? commandController.trackedChildren(parent)
        : [];
      const promptForChildren =
        possibleChildren.length > 1 &&
        determineInteractionMode(args) === "interactive";
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

function registerModify(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
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
      request = await resolveModifyStaging(request, commandController, args);
      commandController.modify(request);
    },
  });
}

function registerRestack(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
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

function registerMove(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
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
          : await selectMoveTarget(commandController, branch, args);
      const request: MoveRequest = {
        branch,
        parent,
        scope: args.only ? "branch-only" : "with-descendants",
      };
      commandController.move(request);
    },
  });
}

function registerSquash(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
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

function registerContinue(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
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

function registerAbort(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
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
    handler: (args) => abort(args),
  });
}

function registerUndo(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
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

function registerSubmit(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
  return parser.command({
    command: ["submit", "s"],
    describe:
      "Idempotently push branches in the current stack to GitHub, creating or updating one pull request per branch. Validates restack state and protects remote changes with force-with-lease. Use --stack to include descendants of the current branch.",
    builder: (command) =>
      command
        .option("draft", {
          alias: "d",
          type: "boolean",
          description: "If set, all new PRs will be created in draft mode.",
          default: false,
        })
        .option("publish", {
          alias: "p",
          type: "boolean",
          description: "If set, publishes all PRs being submitted.",
          default: false,
        })
        .option("restack", {
          type: "boolean",
          description:
            "Restack branches before submitting. If there are conflicts, output the branch names that could not be restacked",
          default: false,
        })
        .option("edit", {
          alias: "e",
          type: "boolean",
          description:
            "Input metadata for all PRs interactively. If neither --edit nor --no-edit is passed, only prompts for new PRs.",
        })
        .option("no-edit", {
          alias: "n",
          type: "boolean",
          description:
            "Don't edit any PR fields inline. Takes precedence over --edit.",
          default: false,
        })
        .option("edit-title", {
          type: "boolean",
          description:
            "Input the PR title interactively. Default only prompts for new PRs. Takes precedence over --no-edit.",
        })
        .option("no-edit-title", {
          type: "boolean",
          description:
            "Don't prompt for the PR title. Takes precedence over --edit-title and --edit.",
        })
        .option("edit-description", {
          type: "boolean",
          description:
            "Input the PR description interactively. Default only prompts for new PRs. Takes precedence over --no-edit.",
        })
        .option("no-edit-description", {
          type: "boolean",
          description:
            "Don't prompt for the PR description. Takes precedence over --edit-description and --edit.",
        })
        .option("ai", {
          type: "boolean",
          description:
            "Automatically AI-generate title and description for all PRs. Only works when creating new PRs. If --edit, use the generated metadata as starting points.",
          default: false,
        })
        .option("no-ai", {
          type: "boolean",
          description:
            "Don't use AI to generate any PR fields. Takes precedence over --ai.",
          default: false,
        })
        .option("reviewers", {
          alias: "r",
          type: "string",
          description:
            "If set without an argument, prompt to manually set reviewers. Alternatively, accepts a comma separated string of reviewers",
          requiresArg: false,
        })
        .option("team-reviewers", {
          alias: "t",
          type: "string",
          description:
            'Comma separated list of team slugs. You can either pass "slug" to this flag or "org/slug" to the reviewers flag. Will enable the --reviewers prompt if set without arguments.',
          requiresArg: false,
        })
        .option("dry-run", {
          type: "boolean",
          description:
            "Reports the PRs that would be submitted and terminates. No branches are restacked or pushed and no PRs are opened or updated.",
          default: false,
        })
        .option("confirm", {
          alias: "c",
          type: "boolean",
          description:
            "Reports the PRs that would be submitted and asks for confirmation before pushing branches and opening/updating PRs. If either of --no-interactive or --dry-run is passed, this flag is ignored.",
          default: false,
        })
        .option("update-only", {
          alias: "u",
          type: "boolean",
          description:
            "Only push branches and update PRs for branches that already have PRs open.",
          default: false,
        })
        .option("force", {
          alias: "f",
          type: "boolean",
          description:
            "Force push: overwrites the remote branch with your local branch. Otherwise defaults to --force-with-lease.",
          default: false,
        })
        .option("always", {
          type: "boolean",
          description:
            "Always push updates, even if the branch has not changed. Useful for repairing inconsistent remote branch state.",
          default: false,
        })
        .option("branch", {
          type: "string",
          description:
            "Which branch to run this command from. Defaults to the current branch.",
        })
        .option("merge-when-ready", {
          alias: "m",
          type: "boolean",
          description:
            "If set, marks all PRs being submitted as merge when ready, which will let them automatically merge as soon as all merge requirements are met.",
          default: false,
        })
        .option("rerequest-review", {
          type: "boolean",
          description: "Rerequest review from current reviewers.",
          default: false,
        })
        .option("view", {
          alias: "v",
          type: "boolean",
          description: "Open the PR in your browser after submitting.",
          default: false,
        })
        .option("comment", {
          type: "string",
          description: "Add a comment on the PR with the given message.",
        })
        .option("cli", {
          type: "boolean",
          description: "Edit PR metadata via the CLI instead of on web.",
        })
        .option("web", {
          alias: "w",
          type: "boolean",
          description:
            "Open a web browser to edit PR metadata, even if no new PRs are being created or if configured to edit PR metadata via the CLI.",
        })
        .option("target-trunk", {
          type: "string",
          description:
            "Which remote trunk should receive the pull requests. Defaults to the current local trunk.",
        })
        .option("ignore-out-of-sync-trunk", {
          type: "boolean",
          description:
            "Perform the submit operation even if the trunk branch is out of sync with its upstream branch. This can lead to incorrect metadata being used during the submit.",
          default: false,
        })
        .option("stack", {
          alias: "s",
          type: "boolean",
          description:
            "Submit descendants of the current branch in addition to its ancestors. Pass --no-stack to submit narrowly and skip the prompt to include branches above the current one that already have open PRs.",
        }),
    handler: (args) => submit(args),
  });
}

function registerLog(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
  return parser.command({
    command: ["log [command]", "l"],
    describe: [
      "Commands that log your stacks.",
      "",
      "Has three forms: `maol-stack log`, `maol-stack log short`, and `maol-stack log long`.",
      "",
      " * `maol-stack log long` displays the commit ancestry of all branches.",
      " * `maol-stack log` and `maol-stack log short` display tracked branch dependencies.",
      "",
      "The default form displays more information than the short form.",
      "",
      "`maol-stack ls` and `maol-stack ll` are aliases for the short and long forms.",
    ].join("\n"),
    builder: (command) =>
      command
        .positional("command", { type: "string" })
        .hide("command")
        .option("classic", {
          type: "boolean",
          description:
            "Use the old short logging style, which runs out of screen real estate more quickly. Other options will not work in classic mode.",
          default: false,
        })
        .option("reverse", {
          alias: "r",
          type: "boolean",
          description:
            "Print the log upside down. Handy when you have a lot of branches!",
          default: false,
        })
        .option("stack", {
          alias: "s",
          type: "boolean",
          description:
            "Only show ancestors and descendants of the current branch.",
          default: false,
        })
        .option("steps", {
          alias: "n",
          type: "number",
          description:
            "Only show this many levels upstack and downstack. Implies --stack.",
        })
        .option("show-untracked", {
          alias: "u",
          type: "boolean",
          description: "Include untracked branched in the log.",
        })
        .option("all", {
          alias: "a",
          type: "boolean",
          description: "Show branches across all configured trunks.",
        }),
    handler: (args) => {
      const steps = typeof args.steps === "number" ? args.steps : undefined;
      const request: LogRequest = {
        acrossTrunks: Boolean(args.all),
        classic: args.classic,
        format: parseLogFormat(args.command ?? "default"),
        includeUntracked: Boolean(args.showUntracked),
        reverse: args.reverse,
        scope: args.stack || steps !== undefined ? "current-stack" : "all",
        steps,
      };
      initializedController(args).log(request);
    },
  });
}

function registerState(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
  return parser.command({
    command: "state",
    describe: "Display information about the state of the repo.",
    handler: (args) => initializedController(args).state(),
  });
}

function registerCheckout(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
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
    handler: (args) => checkout(args),
  });
}

function registerUp(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
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

function registerDown(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
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

function registerTop(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
  return parser.command({
    command: ["top", "t"],
    describe:
      "Switch to the tip branch of the current stack. Prompts if ambiguous.",
    handler: (args) => initializedController(args).top(),
  });
}

function registerBottom(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
  return parser.command({
    command: ["bottom", "b"],
    describe: "Switch to the branch closest to trunk in the current stack.",
    handler: (args) => initializedController(args).bottom(),
  });
}

function registerParent(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
  return parser.command({
    command: "parent",
    describe: "Show the parent of the current branch.",
    handler: (args) => initializedController(args).printParent(),
  });
}

function registerChildren(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
  return parser.command({
    command: "children",
    describe: "Show the children of the current branch.",
    handler: (args) => initializedController(args).printChildren(),
  });
}

function registerTrunk(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
  return parser.command({
    command: "trunk",
    describe: "Show the trunk of the current branch.",
    builder: (command) =>
      command
        .option("all", {
          alias: "a",
          type: "boolean",
          description: "Show all configured trunks.",
        })
        .option("add", {
          type: "string",
          description: "Add an additional trunk.",
        }),
    handler: (args) => {
      const commandController = initializedController(args);
      if (typeof args.add === "string") {
        commandController.addTrunk(args.add);
        return;
      }
      commandController.printTrunk(args.all ? "all" : "active");
    },
  });
}

function registerAdd(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
  return parser.command({
    command: "add [paths..]",
    describe: false,
    builder: (command) =>
      command
        .parserConfiguration({
          "unknown-options-as-args": true,
          "populate--": true,
        })
        .positional("paths", { type: "string", array: true }),
    handler: (args) => initializedController(args).add(args.paths ?? []),
  });
}

function registerMcp(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
  return parser.command({
    command: "mcp",
    describe: "Run the maol-stack MCP server over stdio.",
    handler: async () => startMcpServer(),
  });
}

async function checkout(args: CommandArguments): Promise<void> {
  const commandController = initializedController(args);
  if (args.trunk) {
    commandController.checkout(commandController.trunkBranch());
    return;
  }
  if (typeof args.branch === "string") {
    commandController.checkout(args.branch);
    return;
  }
  if (determineInteractionMode(args) === "non-interactive") {
    throw new Error(
      "Cannot perform interactive operation in non-interactive mode.",
    );
  }
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

async function initialize(args: CommandArguments): Promise<void> {
  const commandController = controller(args);
  const mode = args.reset ? "reset" : "preserve";
  commandController.printInitializationPrelude();
  if (typeof args.trunk === "string") {
    commandController.initializeAfterPrelude(args.trunk, mode);
    return;
  }
  const inferredTrunk = commandController.inferredTrunk();
  if (determineInteractionMode(args) === "non-interactive") {
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

async function track(args: CommandArguments): Promise<void> {
  const commandController = initializedController(args);
  const branch =
    typeof args.branch === "string"
      ? args.branch
      : commandController.currentBranch();
  if (args.force) {
    await trackRecursively(commandController, branch, {
      force: true,
      interaction: determineInteractionMode(args),
    });
    return;
  }
  if (typeof args.parent === "string") {
    commandController.track(branch, args.parent);
    return;
  }
  await trackRecursively(commandController, branch, {
    force: false,
    interaction: determineInteractionMode(args),
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

async function untrack(args: CommandArguments): Promise<void> {
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
  if (determineInteractionMode(args) === "non-interactive") {
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

async function abort(args: CommandArguments): Promise<void> {
  const commandController = initializedController(args);
  const operation = commandController.abortLabel();
  if (!operation || args.force) {
    commandController.abort();
    return;
  }
  if (determineInteractionMode(args) === "non-interactive") {
    throw new Error(
      "Cannot perform interactive operation in non-interactive mode.",
    );
  }
  if (await confirmAbort(operation)) {
    commandController.abort();
    return;
  }
  console.log(brightBlue("🛑 Aborted abort."));
  throw new PromptCancelledError();
}

async function selectMoveTarget(
  commandController: CommandController,
  branch: string,
  args: CommandArguments,
): Promise<string> {
  if (determineInteractionMode(args) === "non-interactive") {
    throw new Error(
      "Cannot perform interactive operation in non-interactive mode.",
    );
  }
  return selectMoveParent({
    branch,
    choices: commandController.moveChoices(
      branch,
      args.all ? "all-trunks" : "active-trunk",
    ),
  });
}

async function resolveCreateStaging(
  request: CreateRequest,
  commandController: CommandController,
  args: CommandArguments,
): Promise<CreateRequest> {
  if (
    request.stageMode !== "staged" ||
    determineInteractionMode(args) === "non-interactive"
  ) {
    return request;
  }
  const changes = commandController.workingChanges();
  if (changes.staged || (!changes.tracked && !changes.untracked)) {
    return request;
  }
  const action = await selectStagingAction({
    hasTrackedChanges: changes.tracked,
    hasUntrackedChanges: changes.untracked,
    operation: "create",
  });
  abortStagingSelection(action, commandController);
  return applyStagingAction(request, action);
}

async function resolveModifyStaging(
  request: ModifyRequest,
  commandController: CommandController,
  args: CommandArguments,
): Promise<ModifyRequest> {
  if (
    request.stageMode !== "staged" ||
    request.message ||
    determineInteractionMode(args) === "non-interactive"
  ) {
    return request;
  }
  const changes = commandController.workingChanges();
  if (changes.staged) {
    return request;
  }
  const action = await selectStagingAction({
    hasTrackedChanges: changes.tracked,
    hasUntrackedChanges: changes.untracked,
    operation: "modify",
  });
  abortStagingSelection(action, commandController);
  if (action === "edit") {
    return { ...request, editMessage: true };
  }
  return applyStagingAction(request, action);
}

function abortStagingSelection(
  action: StagingAction,
  commandController: CommandController,
): void {
  if (action !== "abort") {
    return;
  }
  commandController.restoreIndexAfterCancelledMutation();
  throw new PromptCancelledError();
}

function applyStagingAction<Request extends CreateRequest | ModifyRequest>(
  request: Request,
  action: StagingAction,
): Request {
  if (action === "all" || action === "patch" || action === "update") {
    return { ...request, stageMode: action === "update" ? "updates" : action };
  }
  return request;
}

function submit(args: CommandArguments): void {
  ensureSubmitPublicationIsUnambiguous(args);
  const commandController = initializedController(args);
  const interaction = determineInteractionMode(args);
  const branch =
    typeof args.branch === "string"
      ? args.branch
      : commandController.currentBranch();
  const request: SubmitRequest = {
    branch,
    creationPolicy: args.updateOnly ? "existing-only" : "include-new",
    execution: args.dryRun ? "dry-run" : "apply",
    interaction,
    publication:
      (args.draft || interaction === "non-interactive") && !args.publish
        ? "draft"
        : "ready",
    publicationSelection: args.draft || args.publish ? "explicit" : "default",
    pushMode: args.force ? "force" : "lease",
    remote: "origin",
    scope: args.stack ? "whole-stack" : "current-chain",
    trunkPolicy: args.ignoreOutOfSyncTrunk
      ? "ignore-out-of-sync"
      : "require-synced",
  };
  commandController.submit(
    request,
    args.restack
      ? { branch, scope: args.stack ? "stack" : "downstack" }
      : undefined,
  );
}

function controller(args: object): CommandController {
  const repository = GitRepository.discover(
    resolve(readWorkingDirectory(args)),
  );
  return new CommandController(repository, new MetadataStore(repository));
}

function initializedController(args: object): CommandController {
  const commandController = controller(args);
  commandController.ensureInitialized();
  return commandController;
}

function readWorkingDirectory(args: object): string {
  return "cwd" in args && typeof args.cwd === "string" ? args.cwd : ".";
}

function handleGlobalOptions(args: CommandArguments): void {
  if (args.help) {
    activeParser?.showHelp("error");
    throw new HelpShownError();
  }
  if (args.quiet) {
    silenceStandardOutput();
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

function parseNavigationSteps(value: string): number {
  const steps = Number(value);
  return steps > 1 ? steps : 1;
}

function expandDefaultAliases(args: readonly string[]): string[] {
  const expanded = [...args];
  const commandIndex = findCommandIndex(expanded);
  const command = expanded[commandIndex];
  if (command === "ls") {
    expanded.splice(commandIndex, 1, "log", "short");
  } else if (command === "ll") {
    expanded.splice(commandIndex, 1, "log", "long");
  } else if (command === "ss") {
    expanded.splice(commandIndex, 1, "submit", "--stack");
  }
  return expanded;
}

function findCommandIndex(args: readonly string[]): number {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--cwd") {
      index += 1;
    } else if (!args[index]?.startsWith("-")) {
      return index;
    }
  }
  return 0;
}

function shouldShowTopLevelHelp(args: readonly string[]): boolean {
  return args.length === 0 || !hasCommand(args);
}

function hasCommand(args: readonly string[]): boolean {
  const commandIndex = findCommandIndex(args);
  const candidate = args[commandIndex];
  return Boolean(candidate && !candidate.startsWith("-"));
}

function silenceStandardOutput(): void {
  process.stdout.write = (() => true) as typeof process.stdout.write;
}

function determineInteractionMode(
  args: Pick<GlobalOptions, "interactive" | "quiet">,
): "interactive" | "non-interactive" {
  if (rawArguments.includes("--no-interactive") || args.quiet) {
    return "non-interactive";
  }
  if (rawArguments.includes("--interactive")) {
    return "interactive";
  }
  return process.stdin.isTTY ? "interactive" : "non-interactive";
}

function ensureSubmitPublicationIsUnambiguous(args: CommandArguments): void {
  if (args.draft && args.publish) {
    throw new Error(
      "Can't use both --publish and --draft flags in one command",
    );
  }
}

function parseLogFormat(value: string): "default" | "long" | "short" {
  return value === "short" || value === "long" ? value : "default";
}

function joinMessageParagraphs(
  paragraphs: readonly string[] | undefined,
): string | undefined {
  return paragraphs && paragraphs.length > 0
    ? paragraphs.join("\n\n")
    : undefined;
}
