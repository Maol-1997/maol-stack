import yargs, { type ArgumentsCamelCase, type Argv } from "yargs";

import { silenceStandardOutput } from "./arguments.js";
import { registerInit } from "./commands/init.js";
import { registerAdd, registerMcp } from "./commands/misc.js";
import {
  registerCreate,
  registerModify,
  registerMove,
  registerSquash,
} from "./commands/mutations.js";
import {
  registerBottom,
  registerCheckout,
  registerDown,
  registerTop,
  registerUp,
} from "./commands/navigation.js";
import {
  registerAbort,
  registerContinue,
  registerRestack,
  registerUndo,
} from "./commands/restack.js";
import {
  registerChildren,
  registerLog,
  registerParent,
  registerState,
  registerTrunk,
} from "./commands/display.js";
import { registerSubmit } from "./commands/submit.js";
import { registerTrack, registerUntrack } from "./commands/tracking.js";

const HELP_WRAP_MARGIN = 2;
const MAX_HELP_WIDTH = 110;

export const TOP_LEVEL_HELP = `maol-stack is a local, independent CLI for stacked GitHub pull requests.
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

export type GlobalOptions = {
  readonly cwd?: string;
  readonly debug: boolean;
  readonly help: boolean;
  readonly interactive: boolean;
  readonly quiet: boolean;
  readonly verify: boolean;
};

export type CommandArguments = ArgumentsCamelCase<
  GlobalOptions & Record<string, unknown>
>;

export class HelpShownError extends Error {}
export class ParserFailureError extends Error {}

type CommandRegistration = (
  parser: Argv<GlobalOptions>,
  rawArguments: readonly string[],
) => Argv<GlobalOptions>;

export function createParser(
  rawArguments: readonly string[],
): Argv<GlobalOptions> {
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
    .middleware((args) => handleGlobalOptions(args, parser), true)
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
    parser = registerCommand(parser, rawArguments);
  }
  return parser;
}

function commandRegistrations(): readonly CommandRegistration[] {
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

function handleGlobalOptions(
  args: CommandArguments,
  parser: Argv<GlobalOptions>,
): void {
  if (args.help) {
    parser.showHelp("error");
    throw new HelpShownError();
  }
  if (args.quiet) {
    silenceStandardOutput();
  }
}
