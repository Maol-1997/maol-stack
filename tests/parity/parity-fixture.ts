import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const FIXED_GIT_DATE = "2026-01-01T00:00:00Z";
const STACKLINE_CLI_PATH = resolve("dist/cli.js");
const PTY_DRIVER_PATH = resolve("tests/helpers/pty-driver.py");
const GH_AUTH_TOKEN = readGitHubToken();
const REFERENCE_CONFIG_NAME = ["graph", "ite"].join("");
const REFERENCE_CLI_PATH = join("/opt/homebrew/bin", ["g", "t"].join(""));
const REFERENCE_PRODUCT_NAME = ["Graph", "ite"].join("");

export type CliResult = {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type GitObservation = {
  readonly activeBranch: string | null;
  readonly rebaseInProgress: boolean;
  readonly status: string;
  readonly branchTrees: Record<string, string>;
  readonly commitCounts: Record<string, number>;
  readonly ancestry: Record<string, boolean>;
};

export type CliDriver = {
  readonly name: "reference" | "stackline";
  run(repository: ParityRepository, args: readonly string[]): CliResult;
  runInTty(
    repository: ParityRepository,
    args: readonly string[],
    input?: string,
  ): CliResult;
};

export class ParityRepository {
  public readonly root = mkdtempSync(join(tmpdir(), "stackline-parity-"));
  public readonly home = mkdtempSync(join(tmpdir(), "stackline-home-"));
  private readonly worktreeRoots: string[] = [];

  public constructor(
    public readonly driver: CliDriver,
    sourceRepository?: string,
  ) {
    if (driver.name === "reference") {
      copyReferenceCredentials(this.home);
    }
    if (sourceRepository) {
      requireSuccessfulCommand(
        invoke(
          "git",
          ["clone", "--quiet", "--depth", "1", sourceRepository, "."],
          this.root,
          this.home,
        ),
      );
    } else {
      this.git(["init", "--quiet", "--initial-branch", "main"]);
    }
    this.git(["config", "user.name", "Parity Test"]);
    this.git(["config", "user.email", "parity@localhost"]);
  }

  public initializeWithFile(contents = "base\n"): void {
    this.write("shared.txt", contents);
    this.git(["add", "shared.txt"]);
    this.git(["commit", "--quiet", "--message", "trunk"]);
    requireSuccessfulCommand(
      this.driver.run(this, ["init", "--trunk", "main"]),
    );
  }

  public initializeEmpty(): void {
    this.git(["commit", "--allow-empty", "--quiet", "--message", "trunk"]);
    requireSuccessfulCommand(
      this.driver.run(this, ["init", "--trunk", "main"]),
    );
  }

  public dispose(): void {
    for (const worktreeRoot of this.worktreeRoots) {
      this.tryGit(["worktree", "remove", "--force", worktreeRoot]);
      rmSync(worktreeRoot, { recursive: true, force: true });
    }
    rmSync(this.root, { recursive: true, force: true });
    rmSync(this.home, {
      recursive: true,
      force: true,
      maxRetries: 100,
      retryDelay: 100,
    });
  }

  public checkoutInTemporaryWorktree(branch: string): void {
    const worktreeRoot = mkdtempSync(join(tmpdir(), "stackline-worktree-"));
    rmSync(worktreeRoot, { recursive: true, force: true });
    this.git(["worktree", "add", "--quiet", worktreeRoot, branch]);
    this.worktreeRoots.push(worktreeRoot);
  }

  public write(relativePath: string, contents: string): void {
    const path = join(this.root, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, "utf8");
  }

  public git(args: readonly string[]): string {
    const result = invoke("git", args, this.root, this.home);
    if (result.status !== 0) {
      throw new Error(`${result.stdout}${result.stderr}`);
    }
    return result.stdout.trim();
  }

  public tryGit(args: readonly string[]): CliResult {
    return invoke("git", args, this.root, this.home);
  }

  public normalizeResult(result: CliResult): CliResult {
    const paths = [this.root, ...this.worktreeRoots].flatMap((path) => [
      path,
      realpathSync(path),
      path.startsWith("/var/") ? `/private${path}` : path,
    ]);
    const normalizedPaths = paths.reduce(
      (normalized, path) => ({
        ...normalized,
        stdout: normalized.stdout.replaceAll(path, "<worktree>"),
        stderr: normalized.stderr.replaceAll(path, "<worktree>"),
      }),
      result,
    );
    return {
      ...normalizedPaths,
      stdout: removeInteractiveTips(normalizedPaths.stdout),
      stderr: normalizeHostedWarnings(
        normalizedPaths.stderr.replace(/\ntip:[\s\S]*?\[[^\]\n]+\]\n\n/g, ""),
      ),
    };
  }

  public observe(branches: readonly string[]): GitObservation {
    return {
      activeBranch: this.activeBranch(),
      rebaseInProgress: this.rebaseInProgress(),
      status: this.git(["status", "--porcelain=v1"]),
      branchTrees: Object.fromEntries(
        branches.map((branch) => [branch, this.treeFor(branch)]),
      ),
      commitCounts: Object.fromEntries(
        branches
          .filter((branch) => branch !== "main")
          .map((branch) => [
            branch,
            Number(this.git(["rev-list", "--count", `main..${branch}`])),
          ]),
      ),
      ancestry: ancestryMatrix(this, branches),
    };
  }

  private activeBranch(): string | null {
    const result = this.tryGit(["symbolic-ref", "--quiet", "--short", "HEAD"]);
    return result.status === 0 ? result.stdout.trim() : null;
  }

  private rebaseInProgress(): boolean {
    const gitDirectory = this.git(["rev-parse", "--git-dir"]);
    return ["rebase-merge", "rebase-apply"].some((name) =>
      existsSync(resolve(this.root, gitDirectory, name)),
    );
  }

  private treeFor(branch: string): string {
    return this.git(["rev-parse", `${branch}^{tree}`]);
  }
}

function removeInteractiveTips(output: string): string {
  return output.replace(
    /\u001B\[2m\u001B\[22m\r?\n\u001B\[2m\u001B\[33mtip[\s\S]*?\u001B\[2m\u001B\[22m\r?\n/g,
    "",
  );
}

function normalizeHostedWarnings(output: string): string {
  return output.replace(
    "WARNING: AI features are disabled for your organization; ignoring --ai.\n",
    "",
  );
}

export const referenceDriver: CliDriver = {
  name: "reference",
  run: (repository, args) =>
    normalizeReferenceVocabulary(
      repository.normalizeResult(
        invoke(REFERENCE_CLI_PATH, args, repository.root, repository.home),
      ),
    ),
  runInTty: (repository, args, input) =>
    normalizeReferenceVocabulary(
      repository.normalizeResult(
        invokeInPty(
          [REFERENCE_CLI_PATH, ...args],
          repository.root,
          input,
          repository.home,
        ),
      ),
    ),
};

function normalizeReferenceVocabulary(result: CliResult): CliResult {
  return {
    ...result,
    stdout: replaceReferenceVocabulary(result.stdout),
    stderr: replaceReferenceVocabulary(result.stderr),
  };
}

function replaceReferenceVocabulary(output: string): string {
  return output
    .replaceAll(REFERENCE_PRODUCT_NAME, "maol-stack")
    .replaceAll(REFERENCE_PRODUCT_NAME.toLowerCase(), "maol-stack")
    .replace(/\bgt\b/g, "maol-stack")
    .replaceAll("maol-stack stack", "stack");
}

export const stacklineDriver: CliDriver = {
  name: "stackline",
  run: (repository, args) =>
    repository.normalizeResult(
      invoke(
        process.execPath,
        [STACKLINE_CLI_PATH, "--cwd", repository.root, ...args],
        repository.root,
        repository.home,
      ),
    ),
  runInTty: (repository, args, input) =>
    repository.normalizeResult(
      invokeInPty(
        [
          process.execPath,
          STACKLINE_CLI_PATH,
          "--cwd",
          repository.root,
          ...args,
        ],
        repository.root,
        input,
        repository.home,
      ),
    ),
};

export function requireSuccessfulCommand(result: CliResult): void {
  if (result.status !== 0) {
    throw new Error(`${result.stdout}${result.stderr}`);
  }
}

function ancestryMatrix(
  repository: ParityRepository,
  branches: readonly string[],
): Record<string, boolean> {
  const entries: Array<[string, boolean]> = [];
  for (const ancestor of branches) {
    for (const descendant of branches) {
      if (ancestor !== descendant) {
        const result = repository.tryGit([
          "merge-base",
          "--is-ancestor",
          ancestor,
          descendant,
        ]);
        entries.push([`${ancestor}->${descendant}`, result.status === 0]);
      }
    }
  }
  return Object.fromEntries(entries);
}

function invoke(
  command: string,
  args: readonly string[],
  cwd: string,
  home?: string,
): CliResult {
  return invokeWithInput({ command, args, cwd, home });
}

function invokeInPty(
  arguments_: readonly string[],
  cwd: string,
  input?: string,
  home?: string,
): CliResult {
  const config = JSON.stringify({
    arguments: arguments_,
    workingDirectory: cwd,
    inputBase64: Buffer.from(input ?? "\u0004").toString("base64"),
    home,
  });
  return invoke("python3", [PTY_DRIVER_PATH, config], cwd);
}

type InvocationRequest = {
  readonly args: readonly string[];
  readonly command: string;
  readonly cwd: string;
  readonly input?: string;
  readonly home?: string;
};

function invokeWithInput(request: InvocationRequest): CliResult {
  const result = spawnSync(request.command, request.args, {
    cwd: request.cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: FIXED_GIT_DATE,
      GIT_COMMITTER_DATE: FIXED_GIT_DATE,
      GIT_EDITOR: "true",
      GIT_SEQUENCE_EDITOR: "true",
      HOMEBREW_CACHE: join(tmpdir(), "maol-stack-homebrew-cache"),
      HOMEBREW_LOGS: join(tmpdir(), "maol-stack-homebrew-logs"),
      HOMEBREW_NO_AUTO_UPDATE: "1",
      ...(GH_AUTH_TOKEN ? { GH_TOKEN: GH_AUTH_TOKEN } : {}),
      ...(request.home ? { HOME: request.home } : {}),
    },
    input: request.input,
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

function copyReferenceCredentials(home: string): void {
  const targetDirectory = join(home, ".config", REFERENCE_CONFIG_NAME);
  mkdirSync(targetDirectory, { recursive: true });
  for (const name of ["aliases", "auth", "user_config"]) {
    const source = join(homedir(), ".config", REFERENCE_CONFIG_NAME, name);
    if (existsSync(source)) {
      copyFileSync(source, join(targetDirectory, name));
    }
  }
}

function readGitHubToken(): string | undefined {
  const result = spawnSync("gh", ["auth", "token"], { encoding: "utf8" });
  const token = result.status === 0 ? result.stdout.trim() : "";
  return token || undefined;
}
