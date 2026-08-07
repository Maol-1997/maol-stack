import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { STACKLINE_VERSION } from "../version.js";

const CLI_PATH = fileURLToPath(new URL("../cli.js", import.meta.url));
const COMMAND_OUTPUT_LIMIT_BYTES = 10 * 1024 * 1024;

const STACKLINE_GUIDE = `# Stackline agent workflow

Stackline manages a graph of Git branches where each change branch records its parent.

1. Inspect the repository with \`stackline state\` and \`stackline log long\`.
2. Present the proposed stack before creating branches.
3. Write and validate the first logical change.
4. Stage it and run \`stackline create <name> --message <message>\`.
5. Repeat for each dependent change.
6. Use \`stackline modify\` for review fixes on an existing branch.
7. Use \`maol-stack restack --upstack\` after a parent changes outside Stackline.
8. If a conflict pauses a restack, resolve it and call \`maol-stack continue\`, or call \`maol-stack abort\`.
9. Run \`maol-stack submit --stack --dry-run\`, review the plan, then run \`maol-stack submit --stack\` to publish GitHub PRs.

Never use destructive flags without explicit user approval. Inspect state before mutating branches.`;

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "stackline",
    version: STACKLINE_VERSION,
  });
  registerCommandTool(server);
  registerLearningTool(server);
  await server.connect(new StdioServerTransport());
}

function registerCommandTool(server: McpServer): void {
  server.registerTool(
    "run_stackline_cmd",
    {
      description:
        "Run a Stackline CLI command in a Git repository. Inspect state before mutations and request approval for destructive or remote operations.",
      inputSchema: {
        args: z
          .array(z.string())
          .describe("Arguments passed after the stackline executable"),
        cwd: z
          .string()
          .min(1)
          .describe("Absolute repository working directory"),
        why: z.string().min(1).describe("Short reason for running the command"),
      },
      annotations: {
        title: "Run Stackline command",
        openWorldHint: false,
      },
    },
    async ({ args, cwd }) => runStacklineCommand(args, cwd),
  );
}

function registerLearningTool(server: McpServer): void {
  server.registerTool(
    "learn_stackline",
    {
      description: "Learn the safe workflow for stacked branches and restacks.",
      annotations: {
        title: "Learn Stackline",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async () => ({ content: [{ type: "text", text: STACKLINE_GUIDE }] }),
  );
}

function runStacklineCommand(args: readonly string[], cwd: string) {
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
