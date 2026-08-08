import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { CommandController } from "../src/commands/command-controller.js";
import type {
  CreatePullRequestRequest,
  PullRequest,
  PullRequestHost,
} from "../src/github/pull-request-host.js";
import type { SubmitRequest } from "../src/submit/submit-service.js";
import { GitFixture } from "./helpers/git-fixture.js";

describe("submit", () => {
  let fixture: SubmitFixture;

  beforeEach(() => {
    fixture = new SubmitFixture();
    fixture.createThreeBranchStack();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fixture.dispose();
  });

  test("submits a whole stack in dependency order", () => {
    fixture.submit(wholeStackRequest());

    expect(fixture.submissionState()).toEqual({
      createdPullRequests: [
        { base: "main", branch: "first", publication: "ready" },
        { base: "first", branch: "second", publication: "ready" },
        { base: "second", branch: "third", publication: "ready" },
      ],
      remoteRevisions: {
        first: fixture.localRevision("first"),
        second: fixture.localRevision("second"),
        third: fixture.localRevision("third"),
      },
    });
  });

  test("submits only ancestors through the selected branch without --stack", () => {
    fixture.submit({
      ...wholeStackRequest(),
      branch: "second",
      scope: "current-chain",
    });

    expect(fixture.submissionState()).toEqual({
      createdPullRequests: [
        { base: "main", branch: "first", publication: "ready" },
        { base: "first", branch: "second", publication: "ready" },
      ],
      remoteRevisions: {
        first: fixture.localRevision("first"),
        second: fixture.localRevision("second"),
        third: undefined,
      },
    });
  });

  test("does not mutate remotes or pull requests during a dry run", () => {
    fixture.submit({ ...wholeStackRequest(), execution: "dry-run" });

    expect(fixture.submissionState()).toEqual({
      createdPullRequests: [],
      remoteRevisions: {
        first: undefined,
        second: undefined,
        third: undefined,
      },
    });
  });

  test("submits every descendant when started from trunk", () => {
    fixture.submit({ ...wholeStackRequest(), branch: "main" });

    expect(
      fixture.pullRequests.created.map((request) => request.branch),
    ).toEqual(["first", "second", "third"]);
  });

  test("creates new pull requests as drafts when requested", () => {
    fixture.submit({ ...wholeStackRequest(), publication: "draft" });

    expect(
      fixture.pullRequests.created.map((request) => request.publication),
    ).toEqual(["draft", "draft", "draft"]);
  });

  test("updates the base of an existing pull request", () => {
    fixture.submit(wholeStackRequest());
    fixture.pullRequests.setBase("second", "main");

    fixture.submit(wholeStackRequest());

    expect(fixture.pullRequests.updatedBases).toEqual([
      { base: "first", number: 2 },
    ]);
  });

  test("labels an existing unsynchronized pull request like Reference CLI", () => {
    fixture.pullRequests.add("first", "main");
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    fixture.submit({
      ...wholeStackRequest(),
      branch: "first",
      execution: "dry-run",
      scope: "current-chain",
    });

    expect(output.mock.calls.flat().join("")).toContain(
      "▸ first (Sync to GitHub)",
    );
  });

  test("rejects a remote branch changed since the previous submit", () => {
    fixture.submit(wholeStackRequest());
    fixture.replaceRemoteBranch("first", "main");

    expect(() => fixture.submit(wholeStackRequest())).toThrow(
      "changed since the last submit",
    );
  });

  test("rejects an existing unknown remote branch", () => {
    fixture.pushWithoutMaolStack("first");
    fixture.amendBranch("first");

    expect(() =>
      fixture.submit({
        ...wholeStackRequest(),
        branch: "first",
        scope: "current-chain",
      }),
    ).toThrow("was not submitted by maol-stack");
  });

  test("allows an explicit force push over an unknown remote branch", () => {
    fixture.pushWithoutMaolStack("first");
    fixture.amendBranch("first");

    fixture.submit({
      ...wholeStackRequest(),
      branch: "first",
      pushMode: "force",
      scope: "current-chain",
    });

    expect(fixture.remoteRevision("first")).toBe(
      fixture.localRevision("first"),
    );
  });

  test("rejects a stack whose parent is missing from a child history", () => {
    fixture.amendBranch("first");

    expect(() => fixture.submit(wholeStackRequest())).toThrow(
      "second is not restacked on first",
    );
  });

  test("submits with an out-of-sync trunk by default", () => {
    fixture.replaceRemoteBranch("main", "first");

    fixture.submit(wholeStackRequest());

    expect(fixture.pullRequests.created).toHaveLength(3);
  });

  test("allows an explicit out-of-sync trunk override", () => {
    fixture.replaceRemoteBranch("main", "first");

    fixture.submit({
      ...wholeStackRequest(),
      trunkPolicy: "ignore-out-of-sync",
    });

    expect(fixture.pullRequests.created).toHaveLength(3);
  });
});

class SubmitFixture {
  public readonly gitFixture = new GitFixture();
  public readonly pullRequests = new FakePullRequestHost();
  private readonly remoteRoot = mkdtempSync(
    join(tmpdir(), "maol-stack-remote-"),
  );
  private readonly controller: CommandController;

  public constructor() {
    runGit(this.remoteRoot, ["init", "--bare", "--quiet"]);
    this.gitFixture.git(["remote", "add", "origin", this.remoteRoot]);
    this.gitFixture.git(["push", "--quiet", "origin", "main"]);
    this.controller = new CommandController(
      this.gitFixture.repository,
      this.gitFixture.store,
      this.pullRequests,
    );
    this.controller.initialize("main");
  }

  public createThreeBranchStack(): void {
    this.createBranch("first");
    this.createBranch("second");
    this.createBranch("third");
  }

  public submit(request: SubmitRequest): void {
    this.controller.submit(request);
  }

  public localRevision(branch: string): string {
    return this.gitFixture.repository.resolveRevision(branch);
  }

  public remoteRevision(branch: string): string | undefined {
    const result = tryGit(this.remoteRoot, [
      "rev-parse",
      "--verify",
      `refs/heads/${branch}`,
    ]);
    return result.status === 0 ? result.stdout.trim() : undefined;
  }

  public replaceRemoteBranch(branch: string, revision: string): void {
    this.gitFixture.git([
      "push",
      "--force",
      "--quiet",
      "origin",
      `${revision}:refs/heads/${branch}`,
    ]);
  }

  public pushWithoutMaolStack(branch: string): void {
    this.gitFixture.git(["push", "origin", branch]);
  }

  public amendBranch(branch: string): void {
    this.gitFixture.git(["checkout", "--quiet", branch]);
    this.gitFixture.amendEmpty(`${branch} amended`);
  }

  public submissionState(): {
    readonly createdPullRequests: readonly CreatedPullRequest[];
    readonly remoteRevisions: Record<string, string | undefined>;
  } {
    return {
      createdPullRequests: this.pullRequests.created.map((request) => ({
        base: request.base,
        branch: request.branch,
        publication: request.publication,
      })),
      remoteRevisions: {
        first: this.remoteRevision("first"),
        second: this.remoteRevision("second"),
        third: this.remoteRevision("third"),
      },
    };
  }

  public dispose(): void {
    this.gitFixture.dispose();
    rmSync(this.remoteRoot, { recursive: true, force: true });
  }

  private createBranch(branch: string): void {
    this.gitFixture.write(`${branch}.txt`, `${branch}\n`);
    this.controller.create({
      name: branch,
      message: branch,
      stageMode: "all",
    });
  }
}

type CreatedPullRequest = {
  readonly base: string;
  readonly branch: string;
  readonly publication: "draft" | "ready";
};

class FakePullRequestHost implements PullRequestHost {
  public readonly created: CreatePullRequestRequest[] = [];
  public readonly updatedBases: Array<{ base: string; number: number }> = [];
  private readonly byBranch = new Map<string, PullRequest>();

  public validateRepository(): void {}

  public findOpenPullRequest(branch: string): PullRequest | undefined {
    return this.byBranch.get(branch);
  }

  public createPullRequest(request: CreatePullRequestRequest): PullRequest {
    this.created.push(request);
    const number = this.created.length;
    const pullRequest = {
      base: request.base,
      number,
      url: `https://example.test/pull/${number}`,
    };
    this.byBranch.set(request.branch, pullRequest);
    return pullRequest;
  }

  public updatePullRequestBase(
    pullRequest: PullRequest,
    base: string,
  ): PullRequest {
    this.updatedBases.push({ base, number: pullRequest.number });
    const updatedPullRequest = { ...pullRequest, base };
    this.replacePullRequest(updatedPullRequest);
    return updatedPullRequest;
  }

  public setBase(branch: string, base: string): void {
    const pullRequest = this.byBranch.get(branch);
    if (!pullRequest) {
      throw new Error(`missing fake pull request for ${branch}`);
    }
    this.byBranch.set(branch, { ...pullRequest, base });
  }

  public add(branch: string, base: string): void {
    const number = this.byBranch.size + 1;
    this.byBranch.set(branch, {
      base,
      number,
      url: `https://example.test/pull/${number}`,
    });
  }

  private replacePullRequest(updatedPullRequest: PullRequest): void {
    for (const [branch, pullRequest] of this.byBranch) {
      if (pullRequest.number === updatedPullRequest.number) {
        this.byBranch.set(branch, updatedPullRequest);
        return;
      }
    }
    throw new Error(`missing fake pull request #${updatedPullRequest.number}`);
  }
}

function wholeStackRequest(): SubmitRequest {
  return {
    branch: "third",
    creationPolicy: "include-new",
    execution: "apply",
    interaction: "interactive",
    publication: "ready",
    publicationSelection: "default",
    pushMode: "lease",
    remote: "origin",
    scope: "whole-stack",
    trunkPolicy: "require-synced",
  };
}

function runGit(workingDirectory: string, args: readonly string[]): string {
  const result = tryGit(workingDirectory, args);
  if (result.status !== 0) {
    throw new Error(`${result.stdout}${result.stderr}`);
  }
  return result.stdout.trim();
}

function tryGit(
  workingDirectory: string,
  args: readonly string[],
): {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
} {
  const result = spawnSync("git", args, {
    cwd: workingDirectory,
    encoding: "utf8",
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
