import { spawnSync } from "node:child_process";

const COMMAND_OUTPUT_LIMIT_BYTES = 10 * 1024 * 1024;

export type PullRequest = {
  readonly base: string;
  readonly number: number;
  readonly url: string;
};

export type CreatePullRequestRequest = {
  readonly base: string;
  readonly branch: string;
  readonly publication: "draft" | "ready";
  readonly title: string;
};

export interface PullRequestHost {
  validateRepository(): void;
  findOpenPullRequest(branch: string): PullRequest | undefined;
  createPullRequest(request: CreatePullRequestRequest): PullRequest;
  updatePullRequestBase(pullRequest: PullRequest, base: string): PullRequest;
}

type GitHubPullRequest = {
  readonly baseRefName: string;
  readonly number: number;
  readonly url: string;
};

type CommandInvocation = {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
};

export class GitHubCli implements PullRequestHost {
  public constructor(private readonly workingDirectory: string) {}

  public validateRepository(): void {
    const invocation = invokeGit(this.workingDirectory, [
      "remote",
      "get-url",
      "origin",
    ]);
    if (invocation.status !== 0 || !invocation.stdout.trim()) {
      throw new Error(
        "Could not determine the owner of this repository. Configure a GitHub remote and try again.",
      );
    }
  }

  public findOpenPullRequest(branch: string): PullRequest | undefined {
    const output = this.execute([
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "open",
      "--limit",
      "1",
      "--json",
      "number,url,baseRefName",
    ]);
    const pullRequests = JSON.parse(output) as GitHubPullRequest[];
    const pullRequest = pullRequests[0];
    return pullRequest ? fromGitHubPullRequest(pullRequest) : undefined;
  }

  public createPullRequest(request: CreatePullRequestRequest): PullRequest {
    const draftArguments = request.publication === "draft" ? ["--draft"] : [];
    this.execute([
      "pr",
      "create",
      "--head",
      request.branch,
      "--base",
      request.base,
      "--title",
      request.title,
      "--body",
      "",
      ...draftArguments,
    ]);
    const pullRequest = this.findOpenPullRequest(request.branch);
    if (!pullRequest) {
      throw new Error(
        `GitHub did not return the PR created for ${request.branch}`,
      );
    }
    return pullRequest;
  }

  public updatePullRequestBase(
    pullRequest: PullRequest,
    base: string,
  ): PullRequest {
    this.execute(["pr", "edit", String(pullRequest.number), "--base", base]);
    return { ...pullRequest, base };
  }

  private execute(args: readonly string[]): string {
    const invocation = invokeGitHub(this.workingDirectory, args);
    if (invocation.status !== 0) {
      const details = `${invocation.stdout}${invocation.stderr}`.trim();
      throw new Error(
        `gh ${args.join(" ")} failed${details ? `: ${details}` : ""}`,
      );
    }
    return invocation.stdout;
  }
}

function fromGitHubPullRequest(pullRequest: GitHubPullRequest): PullRequest {
  return {
    base: pullRequest.baseRefName,
    number: pullRequest.number,
    url: pullRequest.url,
  };
}

function invokeGitHub(
  workingDirectory: string,
  args: readonly string[],
): CommandInvocation {
  const result = spawnSync("gh", args, {
    cwd: workingDirectory,
    encoding: "utf8",
    maxBuffer: COMMAND_OUTPUT_LIMIT_BYTES,
  });
  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        "GitHub CLI (gh) is required for submit; install it and run `gh auth login`",
      );
    }
    throw result.error;
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function invokeGit(
  workingDirectory: string,
  args: readonly string[],
): CommandInvocation {
  const result = spawnSync("git", args, {
    cwd: workingDirectory,
    encoding: "utf8",
    maxBuffer: COMMAND_OUTPUT_LIMIT_BYTES,
  });
  if (result.error) {
    throw result.error;
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
