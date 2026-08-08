import {
  ensureNoPausedRestack,
  requireExistingBranch,
  untrackedBranchError,
} from "../errors.js";
import { GitRepository } from "../git/git-repository.js";
import { MetadataStore } from "../metadata/metadata-store.js";
import type { RepositoryMetadata } from "../metadata/schemas.js";
import { COMMON_TRUNK_NAMES, configuredTrunks } from "../metadata/trunks.js";
import { brightBlue, colors } from "../output/colors.js";
import { StackGraph } from "../stack/stack-graph.js";

export class TrackingService {
  public constructor(
    private readonly repository: GitRepository,
    private readonly store: MetadataStore,
  ) {}

  public initialize(
    trunk?: string,
    mode: "preserve" | "reset" = "preserve",
  ): void {
    this.printInitializationPrelude();
    this.initializeAfterPrelude(trunk, mode);
  }

  public printInitializationPrelude(): void {
    process.stdout.write(
      this.store.isInitialized()
        ? "Reinitializing maol-stack...\n\n"
        : "Welcome to maol-stack!\n\n",
    );
  }

  public initializeAfterPrelude(
    trunk?: string,
    mode: "preserve" | "reset" = "preserve",
  ): void {
    if (this.store.isInitialized()) {
      const metadata = this.store.loadMetadata();
      const trunkBranch = trunk ?? metadata.trunk;
      metadata.trunk = trunkBranch;
      if (mode === "reset") {
        metadata.branches = {};
      }
      this.store.saveMetadata(metadata);
      if (mode === "reset") {
        process.stdout.write(
          `Trunk set to ${colors.green(trunkBranch)}\nAll branches have been untracked\n\n`,
        );
        return;
      }
      process.stdout.write(`Trunk set to ${colors.green(trunkBranch)}\n\n`);
      return;
    }
    const trunkBranch = trunk ?? this.repository.currentBranch();
    if (!this.repository.branchExists(trunkBranch)) {
      throw new Error(`trunk branch ${trunkBranch} does not exist`);
    }
    this.store.saveMetadata({ version: 1, trunk: trunkBranch, branches: {} });
    process.stdout.write(`Trunk set to ${colors.green(trunkBranch)}\n\n`);
  }

  public initializationBranches(): string[] {
    return this.repository.localBranches();
  }

  public inferredTrunk(): string | undefined {
    const candidates = this.repository
      .localBranches()
      .filter((branch) => COMMON_TRUNK_NAMES.includes(branch));
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  public ensureInitialized(): void {
    if (this.store.isInitialized()) {
      return;
    }
    process.stdout.write(
      "maol-stack has not been initialized, attempting to setup now...\n\n",
    );
    this.initialize();
  }

  public track(
    branch?: string,
    parent?: string,
    mode: "explicit" | "nearest-ancestor" | "recursive" = "explicit",
  ): void {
    ensureNoPausedRestack(this.store);
    const metadata = this.store.loadMetadata();
    const trackedBranch = branch ?? this.repository.currentBranch();
    requireExistingBranch(this.repository, trackedBranch);
    const graph = new StackGraph(metadata);
    if (graph.isTrunk(trackedBranch)) {
      console.log(`Tracking with trunk ${brightBlue(trackedBranch)}.`);
      return;
    }
    if (graph.isTracked(trackedBranch)) {
      console.log(`${colors.cyan(trackedBranch)} is already tracked.`);
      return;
    }
    const parentBranch =
      mode === "nearest-ancestor"
        ? this.nearestTrackedAncestor(metadata, trackedBranch)
        : (parent ?? metadata.trunk);
    if (
      mode !== "explicit" &&
      parentBranch === metadata.trunk &&
      Object.keys(metadata.branches).length === 0
    ) {
      console.log(`Tracking with trunk ${brightBlue(metadata.trunk)}.`);
    }
    this.validateTrackRequest(metadata, trackedBranch, parentBranch);
    metadata.branches[trackedBranch] = {
      parent: parentBranch,
      base: this.repository.mergeBase(parentBranch, trackedBranch),
    };
    this.store.saveMetadata(metadata);
    const commitCount = this.repository.commitCount(
      `${parentBranch}..${trackedBranch}`,
    );
    console.log(
      `Tracked branch ${colors.green(trackedBranch)} with parent ${brightBlue(parentBranch)} ${colors.dim(`(includes ${commitCount} ${pluralizeCommit(commitCount)})`)}.`,
    );
  }

  public trackParentChoices(branch?: string): string[] {
    const trackedBranch = branch ?? this.repository.currentBranch();
    requireExistingBranch(this.repository, trackedBranch);
    return this.repository
      .localBranches()
      .filter(
        (candidate) =>
          candidate !== trackedBranch &&
          this.repository.isAncestor(candidate, trackedBranch),
      )
      .sort(
        (left, right) =>
          this.repository.commitCount(`${left}..${trackedBranch}`) -
          this.repository.commitCount(`${right}..${trackedBranch}`),
      );
  }

  public isTracked(branch: string): boolean {
    return new StackGraph(this.store.loadMetadata()).isTracked(branch);
  }

  public untrackChildren(branch?: string): string[] {
    const trackedBranch = branch ?? this.repository.currentBranch();
    return new StackGraph(this.store.loadMetadata()).childrenOf(trackedBranch);
  }

  public untrack(
    branch: string | undefined,
    mode: "confirm" | "confirmed" | "force",
  ): void {
    ensureNoPausedRestack(this.store);
    const metadata = this.store.loadMetadata();
    const trackedBranch = branch ?? this.repository.currentBranch();
    requireExistingBranch(this.repository, trackedBranch);
    if (new StackGraph(metadata).isTrunk(trackedBranch)) {
      throw new Error("Can't untrack trunk!");
    }
    if (!metadata.branches[trackedBranch]) {
      console.log(`Branch ${trackedBranch} is not tracked by maol-stack.`);
      return;
    }
    const children = new StackGraph(metadata).childrenOf(trackedBranch);
    if (children.length > 0) {
      if (mode === "confirm") {
        throw new Error(
          "Cannot perform interactive operation in non-interactive mode.",
        );
      }
      if (mode === "force") {
        process.stdout.write(
          `${trackedBranch} has tracked children:\n${children.map((child) => `▸ ${child}`).join("\n")}\n`,
        );
        process.stderr.write(
          "\ntip: If you would like to keep these branches tracked, use `upstack onto` to change their parent before untracking. [untrack.children ●●●]\n\n",
        );
      }
      for (const descendant of new StackGraph(metadata).descendantsOf(
        trackedBranch,
      )) {
        delete metadata.branches[descendant];
      }
    }
    delete metadata.branches[trackedBranch];
    this.store.saveMetadata(metadata);
    console.log(`Untracked branch ${colors.yellow(trackedBranch)}.`);
  }

  public trackedChildren(branch: string): string[] {
    return new StackGraph(this.store.loadMetadata()).childrenOf(branch);
  }

  public isTrunk(branch: string): boolean {
    return new StackGraph(this.store.loadMetadata()).isTrunk(branch);
  }

  public printTrunk(scope: "active" | "all" = "active"): void {
    const metadata = this.store.loadMetadata();
    console.log(
      scope === "all" ? configuredTrunks(metadata).join("\n") : metadata.trunk,
    );
  }

  public addTrunk(branch: string): void {
    if (!this.repository.branchExists(branch)) {
      throw new Error(
        `Branch "${branch}" does not exist. Please create it first.`,
      );
    }
    const metadata = this.store.loadMetadata();
    const trunks = configuredTrunks(metadata);
    if (!trunks.includes(branch)) {
      metadata.trunks = [...trunks, branch];
      this.store.saveMetadata(metadata);
    }
    console.log(`${branch} added as a trunk branch`);
  }

  private validateTrackRequest(
    metadata: RepositoryMetadata,
    branch: string,
    parent: string,
  ): void {
    const graph = new StackGraph(metadata);
    requireExistingBranch(this.repository, branch);
    requireExistingBranch(this.repository, parent);
    if (!graph.isTracked(parent)) {
      throw untrackedBranchError(parent);
    }
  }

  private nearestTrackedAncestor(
    metadata: RepositoryMetadata,
    branch: string,
  ): string {
    const candidates = [metadata.trunk, ...Object.keys(metadata.branches)]
      .filter(
        (candidate) =>
          candidate !== branch && this.repository.isAncestor(candidate, branch),
      )
      .map((candidate) => ({
        branch: candidate,
        distance: this.repository.commitCount(`${candidate}..${branch}`),
      }))
      .sort((left, right) => left.distance - right.distance);
    const nearest = candidates[0]?.branch;
    if (!nearest) {
      throw new Error(`No tracked ancestor found for ${branch}.`);
    }
    return nearest;
  }
}

function pluralizeCommit(count: number): "commit" | "commits" {
  return count === 1 ? "commit" : "commits";
}
