import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const GIT_OUTPUT_LIMIT_BYTES = 10 * 1024 * 1024;

type GitInvocation = {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type RebaseResult = {
  readonly outcome: "completed" | "conflicted" | "skipped";
  readonly output: string;
};

export type PushBranchRequest = {
  readonly branch: string;
  readonly expectedRemoteRevision?: string;
  readonly mode: "force" | "lease";
  readonly remote: string;
};

export class WorktreeBranchError extends Error {
  public constructor(
    public readonly branch: string,
    public readonly worktreePath: string,
  ) {
    super(
      `branch ${branch} is checked out in another worktree: ${worktreePath}`,
    );
    this.name = "WorktreeBranchError";
  }
}

export class GitCommandError extends Error {
  public readonly invocation: GitInvocation;
  public readonly args: readonly string[];

  public constructor(args: readonly string[], invocation: GitInvocation) {
    const details = `${invocation.stdout}${invocation.stderr}`.trim();
    super(
      `Command failed with error exit code ${invocation.status}:\ngit ${args.join(" ")}${details ? `\n\n${details}\n` : "\n"}`,
    );
    this.name = "GitCommandError";
    this.args = args;
    this.invocation = invocation;
  }
}

export class GitRepository {
  public readonly root: string;
  public readonly gitDirectory: string;
  public readonly commonGitDirectory: string;

  private constructor(
    root: string,
    gitDirectory: string,
    commonGitDirectory: string,
  ) {
    this.root = root;
    this.gitDirectory = gitDirectory;
    this.commonGitDirectory = commonGitDirectory;
  }

  public static discover(workingDirectory: string): GitRepository {
    const root = executeGit(workingDirectory, [
      "rev-parse",
      "--show-toplevel",
    ]).trim();
    const gitDirectory = resolveGitPath(
      root,
      executeGit(root, ["rev-parse", "--git-dir"]).trim(),
    );
    const commonGitDirectory = resolveGitPath(
      root,
      executeGit(root, ["rev-parse", "--git-common-dir"]).trim(),
    );
    return new GitRepository(root, gitDirectory, commonGitDirectory);
  }

  public execute(args: readonly string[]): string {
    const invocation = this.invoke(args);
    if (invocation.status !== 0) {
      throw new GitCommandError(args, invocation);
    }
    return invocation.stdout;
  }

  public currentBranch(): string {
    const branch = this.tryCurrentBranch();
    if (!branch) {
      throw new Error(
        "Cannot perform this operation without a branch checked out.",
      );
    }
    return branch;
  }

  public tryCurrentBranch(): string | undefined {
    const invocation = this.invoke([
      "symbolic-ref",
      "--quiet",
      "--short",
      "HEAD",
    ]);
    return invocation.status === 0 ? invocation.stdout.trim() : undefined;
  }

  public resolveRevision(revision: string): string {
    return this.execute(["rev-parse", "--verify", revision]).trim();
  }

  public branchExists(branch: string): boolean {
    return (
      this.invoke(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])
        .status === 0
    );
  }

  public localBranches(): string[] {
    return this.execute([
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads",
    ])
      .trim()
      .split("\n")
      .filter(Boolean)
      .sort();
  }

  public commitExists(revision: string): boolean {
    return this.invoke(["cat-file", "-e", `${revision}^{commit}`]).status === 0;
  }

  public isAncestor(ancestor: string, descendant: string): boolean {
    return (
      this.invoke(["merge-base", "--is-ancestor", ancestor, descendant])
        .status === 0
    );
  }

  public mergeBase(leftRevision: string, rightRevision: string): string {
    return this.execute(["merge-base", leftRevision, rightRevision]).trim();
  }

  public hasTreeChanges(base: string, branch: string): boolean {
    const invocation = this.invoke(["diff", "--quiet", base, branch, "--"]);
    if (invocation.status === 0) {
      return false;
    }
    if (invocation.status === 1) {
      return true;
    }
    throw new GitCommandError(
      ["diff", "--quiet", base, branch, "--"],
      invocation,
    );
  }

  public ensureClean(): void {
    if (this.execute(["status", "--porcelain"]).trim()) {
      throw new Error(
        "working tree is not clean; commit or stash changes first",
      );
    }
  }

  public hasStagedChanges(): boolean {
    const invocation = this.invoke(["diff", "--cached", "--quiet"]);
    if (invocation.status === 0) {
      return false;
    }
    if (invocation.status === 1) {
      return true;
    }
    throw new GitCommandError(["diff", "--cached", "--quiet"], invocation);
  }

  public hasTrackedUnstagedChanges(): boolean {
    const invocation = this.invoke(["diff", "--quiet"]);
    if (invocation.status === 0) {
      return false;
    }
    if (invocation.status === 1) {
      return true;
    }
    throw new GitCommandError(["diff", "--quiet"], invocation);
  }

  public hasUntrackedChanges(): boolean {
    return Boolean(
      this.execute(["ls-files", "--others", "--exclude-standard"]).trim(),
    );
  }

  public checkout(branch: string): void {
    this.execute(["checkout", "--quiet", branch]);
  }

  public checkoutDetached(revision?: string): void {
    const revisionArgument = revision ? [revision] : [];
    this.execute(["checkout", "--quiet", "--detach", ...revisionArgument]);
  }

  public createBranch(branch: string, parent: string): void {
    this.ensureBranchAvailable(branch);
    this.execute(["checkout", "--quiet", "-b", branch, parent]);
  }

  public createBranchAtCurrentRevision(branch: string): void {
    this.ensureBranchAvailable(branch);
    this.execute(["checkout", "--quiet", "-b", branch]);
  }

  public stageAll(): void {
    this.execute(["add", "--all"]);
  }

  public stageUpdates(): void {
    this.execute(["add", "--update"]);
  }

  public stage(args: readonly string[]): void {
    this.execute(["add", ...args]);
  }

  public restoreIndex(revision: string): void {
    this.execute([
      "restore",
      `--source=${revision}`,
      "--staged",
      "-q",
      "--",
      ".",
    ]);
  }

  public stashStagedChanges(): string {
    this.execute([
      "stash",
      "push",
      "--staged",
      "--message",
      "maol-stack restack staged changes",
    ]);
    return this.resolveRevision("refs/stash");
  }

  public restoreStagedChanges(revision: string): void {
    this.execute(["stash", "apply", "--index", revision]);
    if (this.resolveRevision("refs/stash") === revision) {
      this.execute(["stash", "drop", "--quiet", "stash@{0}"]);
    }
  }

  public workingTreePatch(): string {
    return this.execute(["diff", "HEAD", "--binary", "--no-ext-diff"]);
  }

  public applyWorkingTreePatch(patch: string): void {
    const args = ["apply", "--whitespace=nowarn", "-"];
    const invocation = invokeGit(this.root, args, patch);
    if (invocation.status !== 0) {
      throw new GitCommandError(args, invocation);
    }
  }

  public patchBetween(base: string, revision: string): string {
    return this.execute(["diff", base, revision, "--binary", "--no-ext-diff"]);
  }

  public applyAndStagePatch(patch: string): void {
    const args = ["apply", "--index", "--whitespace=nowarn", "-"];
    const invocation = invokeGit(this.root, args, patch);
    if (invocation.status !== 0) {
      throw new GitCommandError(args, invocation);
    }
  }

  public commit(message: string): string {
    return this.execute(["commit", "--message", message]);
  }

  public commitPatch(message: string): string {
    const args = ["commit", "-m", message, "-p", "-q"];
    const invocation = this.invoke(args);
    process.stdout.write(invocation.stdout);
    process.stderr.write(invocation.stderr);
    if (invocation.status !== 0) {
      throw new Error(
        `Command failed with error exit code ${invocation.status}:\n` +
          `git ${args.join(" ")}\n\n`,
      );
    }
    return invocation.stdout;
  }

  public commitAllowEmpty(message: string): string {
    return this.execute(["commit", "--allow-empty", "--message", message]);
  }

  public amend(
    message?: string,
    authorPolicy: "preserve" | "reset" = "preserve",
  ): string {
    const messageArgs = message ? ["--message", message] : ["--no-edit"];
    const authorArgs = authorPolicy === "reset" ? ["--reset-author"] : [];
    return this.execute(["commit", "--amend", ...messageArgs, ...authorArgs]);
  }

  public amendWithEditor(
    authorPolicy: "preserve" | "reset" = "preserve",
  ): void {
    const authorArgs = authorPolicy === "reset" ? ["--reset-author"] : [];
    const args = ["commit", "--amend", ...authorArgs];
    const result = spawnSync("git", args, {
      cwd: this.root,
      env: process.env,
      stdio: "inherit",
    });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(
        `Command failed with error exit code ${result.status ?? 1}:\ngit ${args.join(" ")}\n`,
      );
    }
  }

  public amendPatch(
    message?: string,
    authorPolicy: "preserve" | "reset" = "preserve",
  ): string {
    const messageArgs = message ? ["-m", message] : ["--no-edit"];
    const authorArgs = authorPolicy === "reset" ? ["--reset-author"] : [];
    const args = ["commit", "--amend", "-p", ...messageArgs, ...authorArgs];
    const invocation = this.invoke(args);
    process.stdout.write(invocation.stdout);
    process.stderr.write(invocation.stderr);
    if (invocation.status !== 0) {
      throw new GitCommandError(args, invocation);
    }
    return "";
  }

  public interactiveRebase(base: string): void {
    const args = ["rebase", "--interactive", base];
    const invocation = this.invoke(args);
    if (invocation.status !== 0) {
      throw new GitCommandError(args, invocation);
    }
    process.stdout.write(invocation.stdout);
    process.stderr.write(invocation.stderr);
  }

  public commitSubject(revision: string): string {
    return this.execute(["log", "-1", "--format=%s", revision]).trim();
  }

  public commitAuthorDate(revision: string): string {
    return this.execute([
      "show",
      "--no-patch",
      "--format=%ad",
      "--date=format:%a %b %-d %H:%M:%S %Y %z",
      revision,
    ]).trim();
  }

  public commitRelativeDate(revision: string): string {
    return this.execute(["log", "-1", "--format=%cr", revision]).trim();
  }

  public shortRevision(revision: string): string {
    return this.execute(["rev-parse", "--short=7", revision]).trim();
  }

  public longLog(): string {
    return this.execute([
      "log",
      "--graph",
      "--all",
      "--date=relative",
      "--pretty=format:%h - (%cr) %s - %an%d",
    ]);
  }

  public commitCount(range: string): number {
    return Number(this.execute(["rev-list", "--count", range]).trim());
  }

  public resetSoft(revision: string): void {
    this.execute(["reset", "--soft", revision]);
  }

  public resetHard(revision: string): void {
    this.execute(["reset", "--hard", "--quiet", revision]);
  }

  public rebaseOnto(
    branch: string,
    parent: string,
    oldBase: string,
  ): RebaseResult {
    this.ensureBranchAvailable(branch);
    const args = ["rebase", "--onto", parent, oldBase, branch];
    return this.toRebaseResult(args, this.invoke(args));
  }

  public continueRebase(): RebaseResult {
    const args = ["rebase", "--continue"];
    return this.toRebaseResult(args, this.invoke(args));
  }

  public abortRebase(): void {
    if (this.rebaseInProgress()) {
      this.execute(["rebase", "--abort"]);
    }
  }

  public rebaseInProgress(): boolean {
    return ["rebase-merge", "rebase-apply"].some((name) =>
      existsSync(this.gitPath(name)),
    );
  }

  public unmergedPaths(): string[] {
    return this.execute(["diff", "--name-only", "--diff-filter=U"])
      .trim()
      .split("\n")
      .filter(Boolean);
  }

  public updateBranch(branch: string, revision: string): void {
    this.execute(["update-ref", `refs/heads/${branch}`, revision]);
  }

  public deleteBranchReference(branch: string): void {
    this.execute(["update-ref", "-d", `refs/heads/${branch}`]);
  }

  public remoteBranchRevision(
    remote: string,
    branch: string,
  ): string | undefined {
    const reference = `refs/heads/${branch}`;
    const invocation = this.invoke(["ls-remote", "--heads", remote, reference]);
    if (invocation.status !== 0) {
      throw new GitCommandError(["ls-remote", remote, reference], invocation);
    }
    const revision = invocation.stdout.trim().split(/\s+/)[0];
    return revision || undefined;
  }

  public pushBranch(request: PushBranchRequest): void {
    const remoteReference = `refs/heads/${request.branch}`;
    const safetyArgument =
      request.mode === "force"
        ? "--force"
        : `--force-with-lease=${remoteReference}:${request.expectedRemoteRevision ?? ""}`;
    this.execute([
      "push",
      "--set-upstream",
      safetyArgument,
      request.remote,
      `${request.branch}:${remoteReference}`,
    ]);
  }

  private ensureBranchAvailable(branch: string): void {
    const currentRoot = resolve(this.root);
    const lines = this.execute(["worktree", "list", "--porcelain"]).split("\n");
    let worktreePath: string | undefined;
    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        worktreePath = line.slice("worktree ".length);
      }
      if (
        line === `branch refs/heads/${branch}` &&
        resolve(worktreePath ?? "") !== currentRoot
      ) {
        throw new WorktreeBranchError(branch, worktreePath ?? "unknown");
      }
    }
  }

  private toRebaseResult(
    args: readonly string[],
    invocation: GitInvocation,
  ): RebaseResult {
    const output = `${invocation.stdout}${invocation.stderr}`;
    if (invocation.status === 0) {
      return { outcome: "completed", output };
    }
    if (this.rebaseInProgress()) {
      return { outcome: "conflicted", output };
    }
    throw new GitCommandError(args, invocation);
  }

  private gitPath(name: string): string {
    const invocation = this.invoke(["rev-parse", "--git-path", name]);
    return invocation.status === 0
      ? resolveGitPath(this.root, invocation.stdout.trim())
      : resolve(this.gitDirectory, name);
  }

  private invoke(args: readonly string[]): GitInvocation {
    return invokeGit(this.root, args);
  }
}

function executeGit(workingDirectory: string, args: readonly string[]): string {
  const invocation = invokeGit(workingDirectory, args);
  if (invocation.status !== 0) {
    throw new GitCommandError(args, invocation);
  }
  return invocation.stdout;
}

function invokeGit(
  workingDirectory: string,
  args: readonly string[],
  input?: string,
): GitInvocation {
  const result = spawnSync("git", args, {
    cwd: workingDirectory,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_EDITOR: "true",
      GIT_SEQUENCE_EDITOR: "true",
    },
    maxBuffer: GIT_OUTPUT_LIMIT_BYTES,
    input,
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

function resolveGitPath(root: string, gitPath: string): string {
  return resolve(root, gitPath);
}
