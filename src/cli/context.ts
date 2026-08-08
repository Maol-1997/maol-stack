import { resolve } from "node:path";

import { CommandController } from "../commands/command-controller.js";
import { GitRepository } from "../git/git-repository.js";
import { MetadataStore } from "../metadata/metadata-store.js";
import type { GlobalOptions } from "./parser.js";

export type InteractionMode = "interactive" | "non-interactive";

export function controller(args: object): CommandController {
  const repository = GitRepository.discover(
    resolve(readWorkingDirectory(args)),
  );
  return new CommandController(repository, new MetadataStore(repository));
}

export function initializedController(args: object): CommandController {
  const commandController = controller(args);
  commandController.ensureInitialized();
  return commandController;
}

export function readWorkingDirectory(args: object): string {
  return "cwd" in args && typeof args.cwd === "string" ? args.cwd : ".";
}

export function determineInteractionMode(
  args: Pick<GlobalOptions, "interactive" | "quiet">,
  rawArguments: readonly string[],
): InteractionMode {
  if (rawArguments.includes("--no-interactive") || args.quiet) {
    return "non-interactive";
  }
  if (rawArguments.includes("--interactive")) {
    return "interactive";
  }
  return process.stdin.isTTY ? "interactive" : "non-interactive";
}

export function requireInteractive(mode: InteractionMode): void {
  if (mode === "non-interactive") {
    throw new Error(
      "Cannot perform interactive operation in non-interactive mode.",
    );
  }
}
