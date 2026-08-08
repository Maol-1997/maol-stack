import {
  GitRepository,
  type RebaseResult,
  WorktreeBranchError,
} from "../git/git-repository.js";
import {
  ensureNoPausedRestack,
  requireExistingBranch,
  untrackedBranchError,
} from "../errors.js";
import { MetadataStore } from "../metadata/metadata-store.js";
import type {
  RepositoryMetadata,
  RestackOperation,
  UndoSnapshot,
} from "../metadata/schemas.js";
import { colors } from "../output/colors.js";
import { StackGraph } from "./stack-graph.js";

export type RestackScope = "stack" | "upstack" | "downstack" | "only";

export type RestackRequest = {
  readonly branch: string;
  readonly scope: RestackScope;
};

type RestackOutcome = "completed" | "conflicted";

type ConflictBehavior = "pause" | "abort-automatic-restack";

type SnapshotRestoreMode = "refs-only" | "restore-worktree";

export class RestackConflictError extends Error {
  public constructor() {
    super("restack paused because of conflicts");
    this.name = "RestackConflictError";
  }
}

type BranchRestackContext = {
  readonly metadata: RepositoryMetadata;
  readonly branch: string;
};

export class RestackService {
  public constructor(
    private readonly repository: GitRepository,
    private readonly store: MetadataStore,
  ) {}

  public start(request: RestackRequest): void {
    ensureNoPausedRestack(this.store);
    const metadata = this.store.loadMetadata();
    const graph = new StackGraph(metadata);
    requireExistingBranch(this.repository, request.branch);
    if (!graph.isTracked(request.branch)) {
      throw untrackedBranchError(request.branch);
    }
    const snapshot = this.store.captureSnapshot(
      metadata,
      restackLabel(request),
    );
    const pendingBranches = selectBranches(metadata, request);
    const hasPreviousAutomaticConflict = pendingBranches.some(
      (branch) => metadata.branches[branch]?.restackRequired,
    );
    const stagedChangesStash =
      this.repository.hasStagedChanges() && !hasPreviousAutomaticConflict
        ? this.repository.stashStagedChanges()
        : undefined;
    const operation = this.createOperation({
      snapshot,
      pendingBranches,
      stagedChangesStash,
    });
    if (this.run(metadata, operation, "pause") === "conflicted") {
      throw new RestackConflictError();
    }
  }

  public startAfterMutation(
    metadata: RepositoryMetadata,
    snapshot: UndoSnapshot,
    branch: string,
  ): void {
    const pendingBranches = new StackGraph(metadata)
      .descendantsOf(branch)
      .filter((descendant) => descendant !== branch);
    this.run(
      metadata,
      this.createOperation({ snapshot, pendingBranches }),
      "abort-automatic-restack",
    );
  }

  public startAfterParentChanges(
    metadata: RepositoryMetadata,
    snapshot: UndoSnapshot,
    branches: readonly string[],
  ): void {
    const graph = new StackGraph(metadata);
    const pendingBranches = uniqueBranches(
      branches.flatMap((branch) => graph.descendantsOf(branch)),
    );
    this.run(
      metadata,
      this.createOperation({
        snapshot,
        pendingBranches,
      }),
      "abort-automatic-restack",
    );
  }

  public continue(): void {
    this.continueResolvedOperation(this.requireOperation());
  }

  public continueWithAllChanges(): void {
    const operation = this.requireOperation();
    this.repository.stageAll();
    this.continueResolvedOperation(operation);
  }

  public abort(): void {
    const operation = this.store.loadOperation();
    if (!operation) {
      throw new Error("No maol-stack operation to abort.");
    }
    this.repository.abortRebase();
    const snapshot = this.store.findSnapshot(operation.snapshotId);
    this.restoreSnapshot(
      snapshot,
      operation.stagedChangesStash ? "refs-only" : "restore-worktree",
    );
    this.restoreStagedChanges(operation);
    this.store.clearOperation();
    this.store.discardSnapshot(operation.snapshotId);
    console.log(`Successfully aborted ${colors.yellow(snapshot.label)}.`);
  }

  public operationLabel(): string | undefined {
    const operation = this.store.loadOperation();
    return operation
      ? this.store.findSnapshot(operation.snapshotId).label
      : undefined;
  }

  public undo(): void {
    ensureNoPausedRestack(this.store);
    this.repository.ensureClean();
    const snapshot = this.store.popSnapshot();
    this.restoreSnapshot(snapshot, "restore-worktree");
    console.log(`Successfully rolled back to before ${snapshot.label}.`);
  }

  private continueResolvedOperation(operation: RestackOperation): void {
    const activeBranch = operation.activeBranch;
    if (!activeBranch) {
      throw new Error("the saved restack has no active branch");
    }
    if (this.repository.unmergedPaths().length > 0) {
      this.printConflictDetails(
        activeBranch,
        "Rebase conflict is not yet resolved.",
      );
      throw new RestackConflictError();
    }
    const rebase = this.repository.continueRebase();
    if (rebase.outcome === "conflicted") {
      this.printConflict(activeBranch);
      return;
    }
    console.log(`Resolved rebase conflict for ${activeBranch}.`);
    const metadata = this.store.loadMetadata();
    this.recordUpdatedBase({ metadata, branch: activeBranch });
    const continuedOperation: RestackOperation = {
      ...operation,
      activeBranch: undefined,
      completedBranches: [...operation.completedBranches, activeBranch],
    };
    this.store.saveMetadata(metadata);
    this.store.saveOperation(continuedOperation);
    if (this.run(metadata, continuedOperation, "pause") === "conflicted") {
      throw new RestackConflictError();
    }
  }

  private run(
    metadata: RepositoryMetadata,
    initialOperation: RestackOperation,
    conflictBehavior: ConflictBehavior,
  ): RestackOutcome {
    let operation = initialOperation;
    while (operation.pendingBranches.length > 0) {
      const [branch, ...pendingBranches] = operation.pendingBranches;
      if (!branch) {
        break;
      }
      operation = { ...operation, activeBranch: branch, pendingBranches };
      this.store.saveOperation(operation);
      let rebase: RebaseResult;
      try {
        rebase = this.restackBranch({ metadata, branch });
      } catch (error) {
        if (!(error instanceof WorktreeBranchError)) {
          this.restoreStagedChanges(operation);
          this.store.clearOperation();
          throw error;
        }
        console.log(
          `Did not restack branch ${error.branch} because it is checked out in worktree ${error.worktreePath}.`,
        );
        rebase = { outcome: "skipped", output: "" };
      }
      if (rebase.outcome === "conflicted") {
        return this.handleConflict({
          behavior: conflictBehavior,
          branch,
          operation,
        });
      }
      operation = {
        ...operation,
        activeBranch: undefined,
        completedBranches: [...operation.completedBranches, branch],
      };
      this.store.saveMetadata(metadata);
      this.store.saveOperation(operation);
    }
    this.store.saveMetadata(metadata);
    this.store.clearOperation();
    if (this.repository.branchExists(operation.originalBranch)) {
      this.repository.checkout(operation.originalBranch);
    }
    this.restoreStagedChanges(operation);
    return "completed";
  }

  private handleConflict(input: {
    readonly behavior: ConflictBehavior;
    readonly branch: string;
    readonly operation: RestackOperation;
  }): RestackOutcome {
    if (input.operation.stagedChangesStash) {
      this.rollbackStagedConflict(input);
      return "conflicted";
    }
    if (input.behavior === "abort-automatic-restack") {
      this.repository.abortRebase();
      this.store.clearOperation();
      this.repository.checkout(input.operation.originalBranch);
      const metadata = this.store.loadMetadata();
      const branchMetadata = metadata.branches[input.branch];
      if (branchMetadata) {
        branchMetadata.restackRequired = true;
        this.store.saveMetadata(metadata);
      }
      process.stdout.write("\n");
      process.stderr.write(
        `WARNING: ${input.branch} could not be restacked cleanly.\n\nPlease resolve conflicts in the current stack with maol-stack restack.\n`,
      );
      return "conflicted";
    }
    this.printConflict(input.branch);
    return "conflicted";
  }

  private printConflict(branch: string): void {
    const metadata = this.store.loadMetadata();
    const parent = metadata.branches[branch]?.parent;
    this.printConflictDetails(
      branch,
      `Hit conflict restacking ${branch} on ${parent ?? metadata.trunk}.`,
    );
  }

  private printConflictDetails(branch: string, heading: string): void {
    const metadata = this.store.loadMetadata();
    const parent = metadata.branches[branch]?.parent;
    const unmergedFiles = this.repository.unmergedPaths();
    process.stdout.write(
      `${heading}\n\n` +
        `Unmerged files:\n${unmergedFiles.join("\n")}\n\n` +
        `You are here (resolving ${branch}):\n◯  ${branch}\n◯  ${parent ?? metadata.trunk}\n\n` +
        "To fix and continue your previous maol-stack command:\n" +
        "(1) resolve the listed merge conflicts\n" +
        "(2) mark items as resolved by adding them one at a time with maol-stack add <file>\n" +
        "(3) run maol-stack continue to continue executing your previous maol-stack command\n" +
        "It's safe to cancel the ongoing rebase with maol-stack abort.\n",
    );
  }

  private rollbackStagedConflict(input: {
    readonly branch: string;
    readonly operation: RestackOperation;
  }): void {
    const snapshot = this.store.findSnapshot(input.operation.snapshotId);
    this.restoreSnapshot(snapshot, "refs-only");
    this.restoreStagedChanges(input.operation);
    this.store.clearOperation();
    this.store.discardSnapshot(snapshot.id);
    console.warn(`WARNING: ${input.branch} could not be restacked cleanly.`);
  }

  private restackBranch(context: BranchRestackContext): RebaseResult {
    const { metadata, branch } = context;
    if (branch === metadata.trunk) {
      return { outcome: "completed", output: "" };
    }
    const branchMetadata = metadata.branches[branch];
    if (!branchMetadata) {
      throw new Error(`branch ${branch} is not tracked`);
    }
    const parentRevision = this.repository.resolveRevision(
      branchMetadata.parent,
    );
    const branchRevision = this.repository.resolveRevision(branch);
    if (
      !branchMetadata.restackRequired &&
      this.repository.isAncestor(parentRevision, branchRevision)
    ) {
      this.recordUpdatedBase(context);
      console.log(
        `${colors.cyan(branch)} does not need to be restacked on ${colors.cyan(branchMetadata.parent)}.`,
      );
      return { outcome: "completed", output: "" };
    }
    this.validateRecordedBase(branch, branchRevision, branchMetadata.base);
    const rebase = this.repository.rebaseOnto(
      branch,
      branchMetadata.parent,
      branchMetadata.base,
    );
    if (rebase.outcome === "completed") {
      this.recordUpdatedBase(context);
      console.log(
        `Restacked ${colors.green(branch)} on ${colors.cyan(branchMetadata.parent)}.`,
      );
    }
    return rebase;
  }

  private validateRecordedBase(
    branch: string,
    branchRevision: string,
    base: string,
  ): void {
    if (!this.repository.commitExists(base)) {
      throw new Error(`recorded base ${base} for ${branch} no longer exists`);
    }
    if (!this.repository.isAncestor(base, branchRevision)) {
      throw new Error(
        `recorded base ${base} is not an ancestor of ${branch}; re-track it`,
      );
    }
  }

  private recordUpdatedBase(context: BranchRestackContext): void {
    const branchMetadata = context.metadata.branches[context.branch];
    if (!branchMetadata) {
      throw new Error(`branch ${context.branch} is not tracked`);
    }
    branchMetadata.base = this.repository.resolveRevision(
      branchMetadata.parent,
    );
    delete branchMetadata.restackRequired;
  }

  private restoreSnapshot(
    snapshot: UndoSnapshot,
    mode: SnapshotRestoreMode,
  ): void {
    const currentMetadata = this.store.loadMetadata();
    this.repository.abortRebase();
    this.repository.checkoutDetached();
    for (const branch of Object.keys(currentMetadata.branches)) {
      if (
        !(branch in snapshot.branchRevisions) &&
        this.repository.branchExists(branch)
      ) {
        this.repository.deleteBranchReference(branch);
      }
    }
    for (const [branch, revision] of Object.entries(snapshot.branchRevisions)) {
      this.repository.updateBranch(branch, revision);
    }
    this.store.saveMetadata(snapshot.metadata);
    if (this.repository.branchExists(snapshot.originalBranch)) {
      this.repository.checkout(snapshot.originalBranch);
    }
    if (mode === "restore-worktree" && snapshot.workingTreePatch) {
      this.repository.applyWorkingTreePatch(snapshot.workingTreePatch);
    }
  }

  private createOperation(input: {
    readonly snapshot: UndoSnapshot;
    readonly pendingBranches: readonly string[];
    readonly stagedChangesStash?: string;
  }): RestackOperation {
    return {
      originalBranch: this.repository.currentBranch(),
      pendingBranches: [...input.pendingBranches],
      completedBranches: [],
      snapshotId: input.snapshot.id,
      stagedChangesStash: input.stagedChangesStash,
    };
  }

  private restoreStagedChanges(operation: RestackOperation): void {
    if (operation.stagedChangesStash) {
      this.repository.restoreStagedChanges(operation.stagedChangesStash);
    }
  }

  private requireOperation(): RestackOperation {
    const operation = this.store.loadOperation();
    if (!operation) {
      throw new Error("No maol-stack operation to continue.");
    }
    return operation;
  }
}

function selectBranches(
  metadata: RepositoryMetadata,
  request: RestackRequest,
): string[] {
  const graph = new StackGraph(metadata);
  if (request.scope === "only") {
    return request.branch === metadata.trunk ? [] : [request.branch];
  }
  if (request.scope === "upstack") {
    return graph.descendantsOf(request.branch);
  }
  if (request.scope === "downstack") {
    return graph.ancestorsOf(request.branch);
  }
  if (request.branch === metadata.trunk) {
    return graph.descendantsOf(metadata.trunk);
  }
  return uniqueBranches([
    ...graph.ancestorsOf(request.branch),
    ...graph.descendantsOf(request.branch),
  ]);
}

function uniqueBranches(branches: readonly string[]): string[] {
  return [...new Set(branches)];
}

function restackLabel(request: RestackRequest): string {
  return request.scope === "stack"
    ? "maol-stack restack"
    : `maol-stack restack --${request.scope}`;
}
