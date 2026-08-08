import type { Argv } from "yargs";

import { startMcpServer } from "../../mcp/mcp-server.js";
import { initializedController } from "../context.js";
import type { GlobalOptions } from "../parser.js";

export function registerAdd(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
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

export function registerMcp(parser: Argv<GlobalOptions>): Argv<GlobalOptions> {
  return parser.command({
    command: "mcp",
    describe: "Run the maol-stack MCP server over stdio.",
    handler: async () => startMcpServer(),
  });
}
