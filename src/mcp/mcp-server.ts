import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { MAOL_STACK_VERSION } from "../version.js";

const CLI_PATH = fileURLToPath(new URL("../cli.js", import.meta.url));
const COMMAND_OUTPUT_LIMIT_BYTES = 10 * 1024 * 1024;

const MAOL_STACK_GUIDE = `# maol-stack agent workflow

maol-stack manages a graph of Git branches where each change branch records its parent.

1. Inspect the repository with \`maol-stack state\` and \`maol-stack log long\`.
2. Present the proposed stack before creating branches.
3. Write and validate the first logical change.
4. Stage it and run \`maol-stack create <name> --message <message>\`.
5. Repeat for each dependent change.
6. Use \`maol-stack modify\` for review fixes on an existing branch.
7. Use \`maol-stack restack --upstack\` after a parent changes outside maol-stack.
8. If a conflict pauses a restack, resolve it and call \`maol-stack continue\`, or call \`maol-stack abort\`.
9. Run \`maol-stack submit --stack --dry-run\`, review the plan, then run \`maol-stack submit --stack\` to publish GitHub PRs.

Never use destructive flags without explicit user approval. Inspect state before mutating branches.`;

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "maol-stack",
    version: MAOL_STACK_VERSION,
  });
  registerCommandTool(server);
  registerLearningTool(server);
  await server.connect(new StdioServerTransport());
}

function registerCommandTool(server: McpServer): void {
  server.registerTool(
    "run_maol_stack_cmd",
    {
      description:
        "Run a maol-stack CLI command in a Git repository. Inspect state before mutations and request approval for destructive or remote operations.",
      inputSchema: {
        args: z
          .array(z.string())
          .describe("Arguments passed after the maol-stack executable"),
        cwd: z
          .string()
          .min(1)
          .describe("Absolute repository working directory"),
        why: z.string().min(1).describe("Short reason for running the command"),
      },
      annotations: {
        title: "Run maol-stack command",
        openWorldHint: false,
      },
    },
    async ({ args, cwd }) => runMaolStackCommand(args, cwd),
  );
}

function registerLearningTool(server: McpServer): void {
  server.registerTool(
    "learn_maol_stack",
    {
      description: "Learn the safe workflow for stacked branches and restacks.",
      annotations: {
        title: "Learn maol-stack",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async () => ({ content: [{ type: "text", text: MAOL_STACK_GUIDE }] }),
  );
}

function runMaolStackCommand(args: readonly string[], cwd: string) {
  const result = spawnSync(
    process.execPath,
    [CLI_PATH, "--cwd", cwd, ...args],
    {
      cwd,
      encoding: "utf8",
      maxBuffer: COMMAND_OUTPUT_LIMIT_BYTES,
    },
  );
  if (result.error) {
    throw result.error;
  }
  const output = `${result.stdout}${result.stderr}`.trim();
  return {
    content: [
      {
        type: "text" as const,
        text: output || "Command completed successfully.",
      },
    ],
    isError: result.status !== 0,
  };
}
