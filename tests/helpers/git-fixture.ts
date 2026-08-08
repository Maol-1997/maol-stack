import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

import { CommandController } from "../../src/commands/command-controller.js";
import { GitRepository } from "../../src/git/git-repository.js";
import { MetadataStore } from "../../src/metadata/metadata-store.js";

export class GitFixture {
  public readonly root: string;
  public readonly repository: GitRepository;
  public readonly store: MetadataStore;
  public readonly controller: CommandController;

  public constructor() {
    this.root = mkdtempSync(join(tmpdir(), "maol-stack-test-"));
    this.git(["init", "--quiet", "--initial-branch", "main"]);
    this.git(["config", "user.name", "maol-stack Test"]);
    this.git(["config", "user.email", "maol-stack@localhost"]);
    this.git(["commit", "--allow-empty", "--quiet", "--message", "trunk"]);
    this.repository = GitRepository.discover(this.root);
    this.store = new MetadataStore(this.repository);
    this.controller = new CommandController(this.repository, this.store);
  }

  public dispose(): void {
    rmSync(this.root, { recursive: true, force: true });
  }

  public git(args: readonly string[]): string {
    const result = spawnSync("git", args, {
      cwd: this.root,
      encoding: "utf8",
      env: { ...process.env, GIT_EDITOR: "true", GIT_SEQUENCE_EDITOR: "true" },
    });
    if (result.status !== 0) {
      throw new Error(`${result.stdout}${result.stderr}`);
    }
    return result.stdout.trim();
  }

  public write(relativePath: string, contents: string): void {
    const path = join(this.root, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, "utf8");
  }

  public read(relativePath: string): string {
    return readFileSync(join(this.root, relativePath), "utf8");
  }

  public commitEmpty(message: string): void {
    this.git(["commit", "--allow-empty", "--quiet", "--message", message]);
  }

  public amendEmpty(message: string): void {
    this.git([
      "commit",
      "--amend",
      "--allow-empty",
      "--quiet",
      "--message",
      message,
    ]);
  }
}
