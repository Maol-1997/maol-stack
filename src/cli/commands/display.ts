import type { Argv } from "yargs";

import type { LogRequest } from "../../output/stack-renderer.js";
import { initializedController } from "../context.js";
import type { GlobalOptions } from "../parser.js";

export function registerLog(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
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

export function registerState(
  parser: Argv<GlobalOptions>,
): Argv<GlobalOptions> {
  return parser.command({
    command: "state",
    describe: "Display information about the state of the repo.",
    handler: (args) => initializedController(args).state(),
  });
}

export function registerParent(
  parser: Argv<GlobalOptions>,
): Argv<GlobalOptions> {
  return parser.command({
    command: "parent",
    describe: "Show the parent of the current branch.",
    handler: (args) => initializedController(args).printParent(),
  });
}

export function registerChildren(
  parser: Argv<GlobalOptions>,
): Argv<GlobalOptions> {
  return parser.command({
    command: "children",
    describe: "Show the children of the current branch.",
    handler: (args) => initializedController(args).printChildren(),
  });
}

export function registerTrunk(
  parser: Argv<GlobalOptions>,
): Argv<GlobalOptions> {
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

function parseLogFormat(value: string): "default" | "long" | "short" {
  return value === "short" || value === "long" ? value : "default";
}
