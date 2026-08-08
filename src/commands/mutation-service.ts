import {
  ensureNoPausedRestack,
  requireExistingBranch,
  trunkOperationError,
  untrackedBranchError,
} from "../errors.js";
import { GitRepository } from "../git/git-repository.js";
import { MetadataStore } from "../metadata/metadata-store.js";
import type { RepositoryMetadata, UndoSnapshot } from "../metadata/schemas.js";
import { brightRed } from "../output/colors.js";
import { RestackService } from "../stack/restack-service.js";
import { StackGraph } from "../stack/stack-graph.js";
import type {
  CreateRequest,
  ModifyRequest,
  MoveRequest,
  WorkingChanges,
} from "./command-controller.js";

type ModifyIntoContext = {
  readonly currentBranch: string;
  readonly metadata: RepositoryMetadata;
  readonly request: ModifyRequest;
  readonly snapshot: UndoSnapshot;
  readonly targetBranch: string;
};

export class MutationService {
  public constructor(
    private readonly repository: GitRepository,
    private readonly store: MetadataStore,
    private readonly restacks: RestackService,
  ) {}

  public create(request: CreateRequest): void {
    ensureNoPausedRestack(this.store);
    const metadata = this.store.loadMetadata();
    const parent = request.parent ?? this.repository.currentBranch();
    if (!new StackGraph(metadata).isTracked(parent)) {
      throw new Error(
        `Branch ${parent} is not tracked by maol-stack. Track it first with maol-stack track.`,
      );
    }
    if (request.stageMode === "all") {
      this.repository.stageAll();
    } else if (request.stageMode === "updates") {
      this.repository.stageUpdates();
    }
    if (request.stageMode !== "patch" && !this.repository.hasStagedChanges()) {
      console.log("No staged changes; creating a branch with no commit.");
    }
    const branch =
      request.name ??
      branchNameFromMessage(requireCreateMessage(request.message));
    if (this.repository.branchExists(branch)) {
      throw new Error("Branch with this name already exists");
    }
    const insertedChildren = this.insertedChildren(
      metadata,
      parent,
      request.placement,
    );
    const snapshot = this.store.captureSnapshot(metadata, "maol-stack create");
    const base = this.repository.resolveRevision(parent);
    try {
      this.createBranchAndCommit(request, parent, branch);
      metadata.branches[branch] = { parent, base };
      for (const insertedChild of insertedChildren) {
        const childMetadata = metadata.branches[insertedChild];
        if (childMetadata) {
          childMetadata.parent = branch;
          childMetadata.restackRequired = true;
        }
      }
      this.store.saveMetadata(metadata);
    } catch (error) {
      this.store.discardSnapshot(snapshot.id);
      throw error;
    }
    if (insertedChildren.length > 0) {
      process.stdout.write("\n");
      this.restacks.startAfterParentChanges(
        metadata,
        snapshot,
        insertedChildren,
      );
    }
  }

  public modify(request: ModifyRequest): void {
    ensureNoPausedRestack(this.store);
    const metadata = this.store.loadMetadata();
    const branch = this.repository.currentBranch();
    const targetBranch = request.target ?? branch;
    this.validateModifyTarget(metadata, branch, targetBranch);
    const branchMetadata = metadata.branches[targetBranch];
    if (!branchMetadata) {
      throw untrackedBranchError(targetBranch);
    }
    if (request.stageMode === "all") {
      this.repository.stageAll();
    } else if (request.stageMode === "updates") {
      this.repository.stageUpdates();
    }
    if (
      request.stageMode !== "patch" &&
      request.commitMode === "new" &&
      !request.editMessage &&
      !this.repository.hasStagedChanges()
    ) {
      throw new Error("there are no staged changes to commit");
    }
    const snapshot = this.store.captureSnapshot(metadata, modifyLabel(request));
    try {
      const hasBranchCommit =
        this.repository.resolveRevision(targetBranch) !== branchMetadata.base;
      const commitMode = hasBranchCommit ? request.commitMode : "new";
      const resolvedRequest = { ...request, commitMode };
      if (targetBranch === branch) {
        process.stdout.write(this.commitModification(resolvedRequest));
      } else {
        this.modifyIntoBranch({
          currentBranch: branch,
          metadata,
          request: resolvedRequest,
          snapshot,
          targetBranch,
        });
        return;
      }
    } catch (error) {
      this.store.discardSnapshot(snapshot.id);
      throw error;
    }
    this.restacks.startAfterMutation(metadata, snapshot, targetBranch);
  }

  public interactiveRebase(): void {
    ensureNoPausedRestack(this.store);
    const metadata = this.store.loadMetadata();
    const branch = this.repository.currentBranch();
    const branchMetadata = metadata.branches[branch];
    if (!branchMetadata) {
      throw untrackedBranchError(branch);
    }
    this.repository.interactiveRebase(branchMetadata.base);
  }

  public move(request: MoveRequest): void {
    ensureNoPausedRestack(this.store);
    this.repository.ensureClean();
    const metadata = this.store.loadMetadata();
    const branch = request.branch ?? this.repository.currentBranch();
    const graph = new StackGraph(metadata);
    requireExistingBranch(this.repository, branch);
    if (graph.isTrunk(branch)) {
      throw trunkOperationError(branch);
    }
    const branchMetadata = metadata.branches[branch];
    if (!branchMetadata) {
      throw untrackedBranchError(branch);
    }
    requireExistingBranch(this.repository, request.parent);
    if (!graph.isTracked(request.parent)) {
      throw untrackedBranchError(request.parent);
    }
    if (branch === request.parent) {
      throw new Error(`Cannot set parent of ${branch} to itself!`);
    }
    if (graph.descendantsOf(branch).includes(request.parent)) {
      process.stderr.write(
        `${brightRed(`ERROR: Cannot set ${request.parent} as the parent of ${branch} because it's a child of it! `)}\n`,
      );
      process.stderr.write(
        `${brightRed("ERROR: Did you mean to do a maol-stack reorder? ")}\n`,
      );
      return;
    }
    const snapshot = this.store.captureSnapshot(
      metadata,
      `maol-stack move --onto ${request.parent}`,
    );
    const previousParent = branchMetadata.parent;
    const detachedChildren =
      request.scope === "branch-only" ? graph.childrenOf(branch) : [];
    branchMetadata.parent = request.parent;
    if (previousParent !== request.parent) {
      if (
        this.repository.resolveRevision(previousParent) ===
        this.repository.resolveRevision(request.parent)
      ) {
        delete branchMetadata.restackRequired;
      } else {
        branchMetadata.restackRequired = true;
      }
    }
    for (const child of detachedChildren) {
      const childMetadata = metadata.branches[child];
      if (childMetadata) {
        childMetadata.parent = previousParent;
        childMetadata.restackRequired = true;
      }
    }
    this.store.saveMetadata(metadata);
    this.restacks.startAfterParentChanges(metadata, snapshot, [
      ...detachedChildren,
      branch,
    ]);
  }

  public squash(message?: string): void {
    ensureNoPausedRestack(this.store);
    this.repository.ensureClean();
    const metadata = this.store.loadMetadata();
    const branch = this.repository.currentBranch();
    if (new StackGraph(metadata).isTrunk(branch)) {
      throw trunkOperationError(branch);
    }
    const branchMetadata = metadata.branches[branch];
    if (!branchMetadata) {
      throw untrackedBranchError(branch);
    }
    if (this.repository.resolveRevision(branch) === branchMetadata.base) {
      throw new Error("No commits to squash.");
    }
    const snapshot = this.store.captureSnapshot(metadata, "maol-stack squash");
    const commitMessage = message ?? this.repository.commitSubject(branch);
    const authorDate = this.repository.commitAuthorDate(branch);
    try {
      this.repository.resetSoft(branchMetadata.base);
      printSquashOutput(
        this.repository.commitAllowEmpty(commitMessage),
        authorDate,
      );
    } catch (error) {
      this.store.discardSnapshot(snapshot.id);
      throw error;
    }
    this.restacks.startAfterMutation(metadata, snapshot, branch);
  }

  public workingChanges(): WorkingChanges {
    return {
      staged: this.repository.hasStagedChanges(),
      tracked: this.repository.hasTrackedUnstagedChanges(),
      untracked: this.repository.hasUntrackedChanges(),
    };
  }

  public insertChildren(
    previousParent: string,
    newParent: string,
    children: readonly string[],
  ): void {
    if (children.length === 0) {
      return;
    }
    const metadata = this.store.loadMetadata();
    const snapshot = this.store.captureSnapshot(
      metadata,
      "maol-stack create --insert",
    );
    const parentRevision = this.repository.resolveRevision(previousParent);
    const newParentRevision = this.repository.resolveRevision(newParent);
    for (const child of children) {
      const childMetadata = metadata.branches[child];
      if (!childMetadata || childMetadata.parent !== previousParent) {
        continue;
      }
      childMetadata.parent = newParent;
      if (parentRevision === newParentRevision) {
        delete childMetadata.restackRequired;
      } else {
        childMetadata.restackRequired = true;
      }
    }
    this.store.saveMetadata(metadata);
    this.restacks.startAfterParentChanges(metadata, snapshot, children);
  }

  public restoreIndexAfterCancelledMutation(): void {
    this.repository.restoreIndex(
      this.repository.resolveRevision("HEAD^{tree}"),
    );
  }

  public add(paths: readonly string[]): void {
    this.repository.stage(paths);
  }

  private createBranchAndCommit(
    request: CreateRequest,
    parent: string,
    branch: string,
  ): void {
    if (request.stageMode !== "patch") {
      this.repository.createBranch(branch, parent);
      this.commitCreatedBranch(request.message, parent, branch);
      return;
    }
    this.repository.checkoutDetached(this.repository.resolveRevision(parent));
    try {
      this.repository.commitPatch(requireMessage(request.message));
      this.repository.createBranchAtCurrentRevision(branch);
    } catch (error) {
      this.repository.checkout(parent);
      throw error;
    }
  }

  private commitCreatedBranch(
    message: string | undefined,
    parent: string,
    branch: string,
  ): void {
    if (!this.repository.hasStagedChanges()) {
      return;
    }
    try {
      printCommitSummary(this.repository.commit(requireMessage(message)));
    } catch (error) {
      this.repository.checkout(parent);
      this.repository.deleteBranchReference(branch);
      throw error;
    }
  }

  private commitModification(request: ModifyRequest): string {
    if (request.stageMode === "patch") {
      return this.repository.amendPatch(
        request.message,
        request.authorPolicy ?? "preserve",
      );
    }
    if (request.commitMode === "new") {
      return this.repository.commit(requireMessage(request.message));
    }
    if (request.editMessage) {
      this.repository.amendWithEditor(request.authorPolicy ?? "preserve");
      return "";
    }
    return this.repository.amend(
      request.message,
      request.authorPolicy ?? "preserve",
    );
  }

  private modifyIntoBranch(input: ModifyIntoContext): void {
    const { currentBranch, metadata, snapshot, targetBranch } = input;
    const originalRevision = this.repository.resolveRevision(currentBranch);
    process.stdout.write(
      this.repository.commit("maol-stack (temporary): staged changes"),
    );
    const temporaryRevision = this.repository.resolveRevision(currentBranch);
    const patch = this.repository.patchBetween(
      `${temporaryRevision}^`,
      temporaryRevision,
    );
    this.repository.resetHard(originalRevision);
    this.repository.checkout(targetBranch);
    this.repository.applyAndStagePatch(patch);
    this.commitModification(input.request);
    this.repository.checkout(currentBranch);
    this.restacks.startAfterMutation(metadata, snapshot, targetBranch);
  }

  private validateModifyTarget(
    metadata: RepositoryMetadata,
    currentBranch: string,
    targetBranch: string,
  ): void {
    requireExistingBranch(this.repository, targetBranch);
    if (new StackGraph(metadata).isTrunk(targetBranch)) {
      throw trunkOperationError(targetBranch);
    }
    if (targetBranch === currentBranch) {
      return;
    }
    const ancestors = new StackGraph(metadata).ancestorsOf(currentBranch);
    if (!ancestors.includes(targetBranch)) {
      throw new Error(
        `Branch ${targetBranch} is not downstack in the current stack. The destination branch must be downstack in the current stack.`,
      );
    }
  }

  private insertedChildren(
    metadata: RepositoryMetadata,
    parent: string,
    placement: "child" | "insert" | undefined,
  ): string[] {
    if (placement !== "insert") {
      return [];
    }
    return new StackGraph(metadata).childrenOf(parent);
  }
}

function branchNameFromMessage(message: string): string {
  const branchName = message
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  if (!branchName) {
    throw new Error("the commit message cannot produce a valid branch name");
  }
  return branchName;
}

function requireMessage(message: string | undefined): string {
  if (!message) {
    throw new Error("a commit message is required");
  }
  return message;
}

function requireCreateMessage(message: string | undefined): string {
  if (!message) {
    throw new Error("Must specify either a branch name or commit message.");
  }
  return message;
}

function printCommitSummary(output: string): void {
  const firstLineEnd = output.indexOf("\n");
  if (firstLineEnd >= 0) {
    process.stdout.write(output.slice(firstLineEnd + 1).trimStart());
  }
}

function modifyLabel(request: ModifyRequest): string {
  const flags = [
    request.stageMode === "all" ? "--all" : undefined,
    request.commitMode === "new" ? "--commit" : undefined,
  ].filter((flag): flag is string => Boolean(flag));
  return ["maol-stack modify", ...flags].join(" ");
}

function printSquashOutput(output: string, authorDate: string): void {
  const firstLineEnd = output.indexOf("\n");
  if (firstLineEnd < 0) {
    process.stdout.write(output);
    return;
  }
  process.stdout.write(
    `${output.slice(0, firstLineEnd + 1)} Date: ${authorDate}\n${output.slice(firstLineEnd + 1)}`,
  );
}
