import type { Argv } from "yargs";

import type { SubmitRequest } from "../../submit/submit-service.js";
import { determineInteractionMode, initializedController } from "../context.js";
import type { CommandArguments, GlobalOptions } from "../parser.js";

export function registerSubmit(
  parser: Argv<GlobalOptions>,
  rawArguments: readonly string[],
): Argv<GlobalOptions> {
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
    handler: (args) => submit(args, rawArguments),
  });
}

function submit(args: CommandArguments, rawArguments: readonly string[]): void {
  ensureSubmitPublicationIsUnambiguous(args);
  const commandController = initializedController(args);
  const interaction = determineInteractionMode(args, rawArguments);
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

function ensureSubmitPublicationIsUnambiguous(args: CommandArguments): void {
  if (args.draft && args.publish) {
    throw new Error(
      "Can't use both --publish and --draft flags in one command",
    );
  }
}
