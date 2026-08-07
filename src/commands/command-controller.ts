import { GitRepository } from "../git/git-repository.js";
import {
  GitHubCli,
  type PullRequestHost,
} from "../github/pull-request-host.js";
import { MetadataStore } from "../metadata/metadata-store.js";
import type { RepositoryMetadata, UndoSnapshot } from "../metadata/schemas.js";
import { configuredTrunks } from "../metadata/trunks.js";
import { brightBlue, brightRed, colors } from "../output/colors.js";
import {
  RestackService,
  type RestackRequest,
} from "../stack/restack-service.js";
import { StackGraph } from "../stack/stack-graph.js";
import { SubmitService, type SubmitRequest } from "../submit/submit-service.js";

export type StageMode = "all" | "patch" | "staged" | "updates";

export type CreateRequest = {
  readonly name?: string;
  readonly message?: string;
  readonly parent?: string;
  readonly placement?: "child" | "insert";
  readonly stageMode: StageMode;
};

export type ModifyRequest = {
  readonly authorPolicy?: "preserve" | "reset";
  readonly editMessage?: boolean;
  readonly message?: string;
  readonly commitMode: "amend" | "new";
  readonly stageMode: StageMode;
  readonly target?: string;
};

export type MoveRequest = {
  readonly branch?: string;
  readonly parent: string;
  readonly scope: "branch-only" | "with-descendants";
};

export type LogRequest = {
  readonly acrossTrunks: boolean;
  readonly classic: boolean;
  readonly format: "default" | "long" | "short";
  readonly includeUntracked: boolean;
  readonly reverse: boolean;
  readonly scope: "all" | "current-stack";
  readonly steps?: number;
};

export type CheckoutRequest = {
  readonly acrossTrunks: boolean;
  readonly includeUntracked: boolean;
  readonly scope: "all" | "current-stack";
};

export type CheckoutChoice = {
  readonly title: string;
  readonly value: string;
};

export type WorkingChanges = {
  readonly staged: boolean;
  readonly tracked: boolean;
  readonly untracked: boolean;
};

type ModifyIntoContext = {
  readonly currentBranch: string;
  readonly metadata: RepositoryMetadata;
  readonly request: ModifyRequest;
  readonly snapshot: UndoSnapshot;
  readonly targetBranch: string;
};

export class CommandController {
  private readonly restacks: RestackService;
  private readonly submissions: SubmitService;

  public constructor(
    private readonly repository: GitRepository,
    private readonly store: MetadataStore,
    pullRequests: PullRequestHost = new GitHubCli(repository.root),
  ) {
    this.restacks = new RestackService(repository, store);
    this.submissions = new SubmitService(repository, store, pullRequests);
  }

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
    const commonTrunkNames = [
      "main",
      "master",
      "development",
      "develop",
      "dev",
      "green",
      "staging",
      "prod",
      "production",
    ];
    const candidates = this.repository
      .localBranches()
      .filter((branch) => commonTrunkNames.includes(branch));
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
    this.ensureNoOperation();
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
    this.ensureNoOperation();
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

  public create(request: CreateRequest): void {
    this.ensureNoOperation();
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
    this.ensureNoOperation();
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

  public restack(request: RestackRequest): void {
    this.restacks.start(request);
  }

  public interactiveRebase(): void {
    this.ensureNoOperation();
    const metadata = this.store.loadMetadata();
    const branch = this.repository.currentBranch();
    const branchMetadata = metadata.branches[branch];
    if (!branchMetadata) {
      throw untrackedBranchError(branch);
    }
    this.repository.interactiveRebase(branchMetadata.base);
  }

  public move(request: MoveRequest): void {
    this.ensureNoOperation();
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
    this.ensureNoOperation();
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

  public continue(): void {
    this.restacks.continue();
  }

  public continueWithAllChanges(): void {
    this.restacks.continueWithAllChanges();
  }

  public abort(): void {
    this.restacks.abort();
  }

  public abortLabel(): string | undefined {
    return this.restacks.operationLabel();
  }

  public undo(): void {
    this.restacks.undo();
  }

  public submit(request: SubmitRequest, restackRequest?: RestackRequest): void {
    const prepareBranches = restackRequest
      ? () => {
          console.log("\n🥞 Restacking branches...");
          this.restacks.start(restackRequest);
        }
      : undefined;
    this.submissions.submit(request, prepareBranches);
  }

  public log(request: LogRequest): void {
    const metadata = this.store.loadMetadata();
    new StackRenderer(this.repository, metadata, request).render();
  }

  public state(): void {
    const metadata = this.store.loadMetadata();
    const branches = Object.entries(metadata.branches)
      .sort(([leftBranch], [rightBranch]) =>
        leftBranch.localeCompare(rightBranch),
      )
      .map(([branch, branchMetadata]) => [
        branch,
        {
          trunk: false,
          needs_restack:
            Boolean(branchMetadata.restackRequired) ||
            !this.repository.isAncestor(
              this.repository.resolveRevision(branchMetadata.parent),
              this.repository.resolveRevision(branch),
            ),
          parents: [{ ref: branchMetadata.parent, sha: branchMetadata.base }],
        },
      ]);
    console.log(
      JSON.stringify(
        Object.fromEntries([
          ...configuredTrunks(metadata).map((trunk) => [
            trunk,
            { trunk: true },
          ]),
          ...branches,
        ]),
        null,
        2,
      ),
    );
  }

  public checkout(branch: string): void {
    this.ensureNoOperation();
    const metadata = this.store.loadMetadata();
    if (!this.repository.branchExists(branch)) {
      throw new Error(`Could not find branch ${branch}.`);
    }
    if (this.repository.tryCurrentBranch() === branch) {
      console.log(`Already on ${colors.cyan(branch)}.`);
      return;
    }
    this.repository.checkout(branch);
    if (!new StackGraph(metadata).isTracked(branch)) {
      process.stdout.write(
        `Checked out ${colors.cyan(branch)}.\nThis branch is not tracked by maol-stack.\n`,
      );
      return;
    }
    if (new StackGraph(metadata).isTrunk(branch)) {
      console.log(`Checked out ${colors.cyan(branch)}.`);
      return;
    }
    this.printCheckout(branch);
  }

  public checkoutChoices(request: CheckoutRequest): CheckoutChoice[] {
    this.ensureNoOperation();
    const metadata = this.store.loadMetadata();
    const graph = new StackGraph(metadata);
    const currentBranch = this.repository.currentBranch();
    const branches = request.acrossTrunks
      ? []
      : request.scope === "current-stack"
        ? currentStackBranches(graph, metadata.trunk, currentBranch)
        : [metadata.trunk, ...graph.descendantsOf(metadata.trunk)].reverse();
    const trackedChoices = request.acrossTrunks
      ? renderAllTrunkCheckoutRows(graph, metadata, currentBranch)
      : renderCheckoutRows(graph, branches, currentBranch);
    if (!request.includeUntracked) {
      return trackedChoices;
    }
    const trackedBranches = new Set(trackedChoices.map(({ value }) => value));
    const untrackedChoices = this.repository
      .localBranches()
      .filter((branch) => !trackedBranches.has(branch))
      .map((branch) => ({ title: `◯  ${branch}`, value: branch }));
    return [...trackedChoices, ...untrackedChoices];
  }

  public moveChoices(
    branch?: string,
    scope: "active-trunk" | "all-trunks" = "active-trunk",
  ): CheckoutChoice[] {
    this.ensureNoOperation();
    const metadata = this.store.loadMetadata();
    const graph = new StackGraph(metadata);
    const movingBranch = branch ?? this.repository.currentBranch();
    const choices =
      scope === "all-trunks"
        ? renderAllTrunkCheckoutRows(graph, metadata, "")
        : renderCheckoutRows(
            graph,
            [metadata.trunk, ...graph.descendantsOf(metadata.trunk)].reverse(),
            "",
          );
    return choices.filter(({ value }) => value !== movingBranch);
  }

  public workingChanges(): WorkingChanges {
    return {
      staged: this.repository.hasStagedChanges(),
      tracked: this.repository.hasTrackedUnstagedChanges(),
      untracked: this.repository.hasUntrackedChanges(),
    };
  }

  public trackedChildren(branch: string): string[] {
    return new StackGraph(this.store.loadMetadata()).childrenOf(branch);
  }

  public isTrunk(branch: string): boolean {
    return new StackGraph(this.store.loadMetadata()).isTrunk(branch);
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

  public up(steps: number, target?: string): void {
    this.ensureNoOperation();
    const graph = new StackGraph(this.store.loadMetadata());
    let branch = this.repository.currentBranch();
    console.log(branch);
    for (let step = 0; step < steps; step += 1) {
      const children = graph.childrenOf(branch);
      if (children.length === 0) {
        break;
      }
      branch = target
        ? requirePathChild(graph, children, target)
        : requireOnlyUpstackBranch(children);
    }
    this.repository.checkout(branch);
    this.printCheckout(branch);
  }

  public down(steps: number): void {
    this.ensureNoOperation();
    const metadata = this.store.loadMetadata();
    const graph = new StackGraph(metadata);
    let branch = this.repository.currentBranch();
    console.log(branch);
    const maximumSteps = Number.isInteger(steps)
      ? steps
      : Number.POSITIVE_INFINITY;
    for (let step = 0; step < maximumSteps; step += 1) {
      const parent = graph.parentOf(branch);
      if (!parent) {
        break;
      }
      branch = parent;
      console.log(`⮑  ${branch}`);
    }
    this.repository.checkout(branch);
    if (branch === metadata.trunk) {
      console.log(`Checked out ${branch}.`);
      return;
    }
    this.printCheckout(branch);
  }

  public top(): void {
    this.ensureNoOperation();
    const graph = new StackGraph(this.store.loadMetadata());
    const currentBranch = this.repository.currentBranch();
    console.log(currentBranch);
    const tips = stackTips(graph, currentBranch);
    const branch = requireOnlyUpstackBranch(tips);
    this.repository.checkout(branch);
    this.printCheckout(branch);
  }

  public bottom(): void {
    this.ensureNoOperation();
    const metadata = this.store.loadMetadata();
    const ancestors = new StackGraph(metadata).ancestorsOf(
      this.repository.currentBranch(),
    );
    const branch = ancestors[0] ?? metadata.trunk;
    console.log(this.repository.currentBranch());
    if (branch === this.repository.currentBranch()) {
      console.log("Already at the bottom most branch in the stack.");
      return;
    }
    console.log(`⮑  ${branch}`);
    this.repository.checkout(branch);
    this.printCheckout(branch);
  }

  public printParent(): void {
    const branch = this.repository.currentBranch();
    const graph = new StackGraph(this.store.loadMetadata());
    if (graph.isTrunk(branch)) {
      throw trunkOperationError();
    }
    const parent = graph.parentOf(branch);
    if (!parent) {
      throw new Error(`${branch} has no parent`);
    }
    console.log(parent);
  }

  public printChildren(): void {
    const graph = new StackGraph(this.store.loadMetadata());
    console.log(graph.childrenOf(this.repository.currentBranch()).join("\n"));
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

  public add(paths: readonly string[]): void {
    this.repository.stage(paths);
  }

  public currentBranch(): string {
    return this.repository.currentBranch();
  }

  public trunkBranch(): string {
    return this.store.loadMetadata().trunk;
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
    const originalRevision = this.repository.resolveRevision(
      input.currentBranch,
    );
    process.stdout.write(
      this.repository.commit("maol-stack (temporary): staged changes"),
    );
    const temporaryRevision = this.repository.resolveRevision(
      input.currentBranch,
    );
    const patch = this.repository.patchBetween(
      `${temporaryRevision}^`,
      temporaryRevision,
    );
    this.repository.resetHard(originalRevision);
    this.repository.checkout(input.targetBranch);
    this.repository.applyAndStagePatch(patch);
    this.commitModification(input.request);
    this.repository.checkout(input.currentBranch);
    this.restacks.startAfterMutation(
      input.metadata,
      input.snapshot,
      input.targetBranch,
    );
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

  private ensureNoOperation(): void {
    if (this.store.loadOperation()) {
      throw new Error(
        "a restack is paused; run maol-stack continue or maol-stack abort first",
      );
    }
  }

  private printCheckout(branch: string): void {
    process.stdout.write(
      `Checked out ${colors.cyan(branch)}.\nThis branch has not yet been submitted.\nRun maol-stack submit to push your changes.\n`,
    );
  }
}

class StackRenderer {
  private readonly graph: StackGraph;
  private readonly currentBranch: string | undefined;

  public constructor(
    private readonly repository: GitRepository,
    private readonly metadata: RepositoryMetadata,
    private readonly request: LogRequest,
  ) {
    this.graph = new StackGraph(metadata);
    this.currentBranch = repository.tryCurrentBranch();
  }

  public render(): void {
    if (this.request.format === "long") {
      process.stdout.write(this.repository.longLog());
      return;
    }
    if (
      this.request.acrossTrunks &&
      this.request.format === "default" &&
      !this.request.classic
    ) {
      this.renderAllTrunkDetailedGraphs();
      return;
    }
    const branches = this.selectBranches();
    if (this.request.classic) {
      this.renderClassic(branches);
      return;
    }
    if (this.renderShortGraph(branches)) {
      this.renderUntrackedBranches();
      return;
    }
    this.renderDetailedGraph(branches);
    this.renderUntrackedBranches();
  }

  private renderAllTrunkDetailedGraphs(): void {
    configuredTrunks(this.metadata).forEach((trunk, index) => {
      if (index > 0) {
        console.log();
      }
      const branches = [trunk, ...this.graph.descendantsOf(trunk)].reverse();
      this.renderDetailedGraph(branches);
    });
  }

  private renderBranch(branch: string, indent = 0, noStem = false): void {
    const marker = branch === this.currentBranch ? "◉" : "◯";
    const restackSuffix = this.needsRestack(branch) ? " (needs restack)" : "";
    if (this.request.format === "short") {
      console.log(`${marker}  ${branch}${restackSuffix}`);
      return;
    }
    const currentSuffix = branch === this.currentBranch ? " (current)" : "";
    const relativeDate = this.repository.commitRelativeDate(branch);
    const revision = this.repository.shortRevision(branch);
    const subject = this.repository.commitSubject(branch);
    const branchIndent = "│  ".repeat(indent);
    const stem = noStem ? " " : "│";
    process.stdout.write(
      `${branchIndent}${marker} ${branch}${currentSuffix}${restackSuffix}\n` +
        `${branchIndent}${stem} ${relativeDate}\n` +
        `${branchIndent}${stem} \n` +
        `${branchIndent}${stem} ${revision} - ${subject}\n` +
        `${branchIndent}${stem}\n`,
    );
  }

  private renderDetailedGraph(branches: readonly string[]): void {
    const includedBranches = new Set(branches);
    const roots = branches.filter((branch) => {
      const parent = this.graph.parentOf(branch);
      return !parent || !includedBranches.has(parent);
    });
    for (const root of roots.reverse()) {
      this.renderDetailedTree(root, 0, includedBranches);
    }
  }

  private renderDetailedTree(
    branch: string,
    indent: number,
    includedBranches: ReadonlySet<string>,
  ): void {
    const allChildren = this.graph.childrenOf(branch);
    const children = allChildren.filter((child) => includedBranches.has(child));
    if (this.request.reverse) {
      this.renderBranch(branch, indent, allChildren.length === 0);
      this.renderBranchingLine(indent, allChildren.length);
      children.forEach((child, index) =>
        this.renderDetailedTree(
          child,
          indent + children.length - index - 1,
          includedBranches,
        ),
      );
      return;
    }
    children.forEach((child, index) =>
      this.renderDetailedTree(child, indent + index, includedBranches),
    );
    this.renderBranchingLine(indent, allChildren.length);
    this.renderBranch(branch, indent);
  }

  private renderBranchingLine(indent: number, childCount: number): void {
    if (childCount < 2) {
      return;
    }
    const middle = this.request.reverse ? "──┬" : "──┴";
    const end = this.request.reverse ? "──┐" : "──┘";
    console.log(
      `${"│  ".repeat(indent)}├${middle.repeat(Math.max(0, childCount - 2))}${end}`,
    );
  }

  private needsRestack(branch: string): boolean {
    const branchMetadata = this.metadata.branches[branch];
    return Boolean(
      branchMetadata &&
      (branchMetadata.restackRequired ||
        !this.repository.isAncestor(
          this.repository.resolveRevision(branchMetadata.parent),
          this.repository.resolveRevision(branch),
        )),
    );
  }

  private renderShortGraph(branches: readonly string[]): boolean {
    if (
      this.request.format !== "short" ||
      this.request.reverse ||
      this.request.steps !== undefined
    ) {
      return false;
    }
    if (this.request.acrossTrunks) {
      this.renderAllTrunkShortGraphs();
      return true;
    }
    for (const choice of renderCheckoutRows(
      this.graph,
      branches,
      this.currentBranch ?? "",
    )) {
      console.log(this.decorateShortChoice(choice));
    }
    return true;
  }

  private renderAllTrunkShortGraphs(): void {
    const trunks = configuredTrunks(this.metadata);
    trunks.forEach((trunk, index) => {
      if (index > 0) {
        console.log();
      }
      const branches = [trunk, ...this.graph.descendantsOf(trunk)].reverse();
      for (const choice of renderCheckoutRows(
        this.graph,
        branches,
        this.currentBranch ?? "",
      )) {
        console.log(this.decorateShortChoice(choice));
      }
    });
  }

  private decorateShortChoice(choice: CheckoutChoice): string {
    return `${choice.title}${this.needsRestack(choice.value) ? " (needs restack)" : ""}`;
  }

  private selectBranches(): string[] {
    const currentBranch = this.currentBranch ?? this.metadata.trunk;
    const allBranches = [
      this.metadata.trunk,
      ...this.graph.descendantsOf(this.metadata.trunk),
    ].reverse();
    const scopedBranches =
      this.request.scope === "current-stack" || this.request.steps !== undefined
        ? this.currentStackBranches(currentBranch)
        : allBranches;
    const steppedBranches = this.applyStepLimit(scopedBranches, currentBranch);
    return this.request.reverse ? steppedBranches.reverse() : steppedBranches;
  }

  private applyStepLimit(
    branches: readonly string[],
    currentBranch: string,
  ): string[] {
    const steps = this.request.steps;
    if (steps === undefined || Number.isNaN(steps)) {
      return [...branches];
    }
    if (steps === 0) {
      return [currentBranch];
    }
    if (steps < 0) {
      const upstackBranches = new Set(this.graph.descendantsOf(currentBranch));
      return branches.filter((branch) => upstackBranches.has(branch));
    }
    return branches.filter(
      (branch) => this.distanceBetween(currentBranch, branch) <= steps,
    );
  }

  private currentStackBranches(currentBranch: string): string[] {
    const ancestors = this.graph.ancestorsOf(currentBranch);
    const descendants = this.graph.descendantsOf(currentBranch);
    return [
      ...new Set([this.metadata.trunk, ...ancestors, ...descendants]),
    ].reverse();
  }

  private distanceBetween(leftBranch: string, rightBranch: string): number {
    const leftPath = [
      this.metadata.trunk,
      ...this.graph.ancestorsOf(leftBranch),
    ];
    const rightPath = [
      this.metadata.trunk,
      ...this.graph.ancestorsOf(rightBranch),
    ];
    const sharedLength = leftPath.findIndex(
      (branch, index) => branch !== rightPath[index],
    );
    const commonLength = sharedLength < 0 ? leftPath.length : sharedLength;
    if (commonLength < Math.min(leftPath.length, rightPath.length)) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.abs(leftPath.length - rightPath.length);
  }

  private renderClassic(branches: readonly string[]): void {
    for (const branch of branches) {
      const depth = this.graph.ancestorsOf(branch).length;
      console.log(`${"  ".repeat(depth)}↱ $ ${branch}`);
    }
  }

  private renderUntrackedBranches(): void {
    if (!this.request.includeUntracked) {
      return;
    }
    const trackedBranches = new Set([
      this.metadata.trunk,
      ...Object.keys(this.metadata.branches),
    ]);
    const untrackedBranches = this.repository
      .localBranches()
      .filter((branch) => !trackedBranches.has(branch));
    if (untrackedBranches.length > 0) {
      process.stdout.write(
        `\nUntracked branches:\n${untrackedBranches.join("\n")}\n`,
      );
    }
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

function requireExistingBranch(
  repository: GitRepository,
  branch: string,
): void {
  if (!repository.branchExists(branch)) {
    throw new Error(`Could not find branch ${branch}.`);
  }
}

function trunkOperationError(branch?: string): Error {
  const context = branch ? `\n\n${branch}` : "";
  return new Error(
    `Cannot perform this operation on the trunk branch.${context}`,
  );
}

function untrackedBranchError(branch: string): Error {
  return new Error(
    `Cannot perform this operation on untracked branch ${branch}.\n` +
      "You can track it by specifying its parent with maol-stack track.",
  );
}

function requireOnlyUpstackBranch(branches: readonly string[]): string {
  if (branches.length === 0) {
    throw new Error("there is no branch in that direction");
  }
  if (branches.length > 1) {
    throw new Error(
      "Cannot get upstack branch in non-interactive mode; multiple choices available:\n" +
        branches.join("\n"),
    );
  }
  return branches[0] as string;
}

function stackTips(graph: StackGraph, branch: string): string[] {
  const children = graph.childrenOf(branch);
  return children.length === 0
    ? [branch]
    : children.flatMap((child) => stackTips(graph, child));
}

function currentStackBranches(
  graph: StackGraph,
  trunk: string,
  currentBranch: string,
): string[] {
  const ancestors = graph.ancestorsOf(currentBranch);
  const descendants = graph.descendantsOf(currentBranch);
  return [...new Set([trunk, ...ancestors, ...descendants])].reverse();
}

function renderCheckoutRows(
  graph: StackGraph,
  branches: readonly string[],
  currentBranch: string,
): CheckoutChoice[] {
  const includedBranches = new Set(branches);
  const roots = branches.filter((branch) => {
    const parent = graph.parentOf(branch);
    return !parent || !includedBranches.has(parent);
  });
  const state: GraphRenderingState = { maximumIndent: 0, rows: [] };
  for (const root of roots.reverse()) {
    renderGraphBranch(
      graph,
      {
        branch: root,
        includedBranches,
        indent: 0,
      },
      state,
    );
  }
  return state.rows.map(({ branch, raw }) => {
    const branchDivider = raw.indexOf("▸");
    const branchSpacing = Math.max(
      0,
      2 * state.maximumIndent + 3 - branchDivider,
    );
    const marker = branch === currentBranch ? "◉" : "◯";
    const graphPrefix = raw.slice(0, branchDivider).replace("◯", marker);
    return {
      title: `${graphPrefix}${" ".repeat(branchSpacing)}${branch}`,
      value: branch,
    };
  });
}

function renderAllTrunkCheckoutRows(
  graph: StackGraph,
  metadata: RepositoryMetadata,
  currentBranch: string,
): CheckoutChoice[] {
  return configuredTrunks(metadata).flatMap((trunk) => [
    ...graph
      .descendantsOf(trunk)
      .reverse()
      .map((branch) => ({
        title: `${branch === currentBranch ? "◉" : "◯"}  ${branch}`,
        value: branch,
      })),
    {
      title: `${trunk === currentBranch ? "◉" : "◯"}  ${trunk} (trunk)`,
      value: trunk,
    },
  ]);
}

type GraphRenderingState = {
  maximumIndent: number;
  readonly rows: Array<{ readonly branch: string; readonly raw: string }>;
};

type GraphBranchRequest = {
  readonly branch: string;
  readonly includedBranches: ReadonlySet<string>;
  readonly indent: number;
};

function renderGraphBranch(
  graph: StackGraph,
  request: GraphBranchRequest,
  state: GraphRenderingState,
): void {
  const children = graph
    .childrenOf(request.branch)
    .filter((branch) => request.includedBranches.has(branch));
  for (const [index, child] of children.entries()) {
    renderGraphBranch(
      graph,
      {
        branch: child,
        includedBranches: request.includedBranches,
        indent: request.indent + index,
      },
      state,
    );
  }
  state.maximumIndent = Math.max(state.maximumIndent, request.indent);
  const forkTail = children.length <= 2 ? "" : "─┴".repeat(children.length - 2);
  const forkEnd = children.length <= 1 ? "" : "─┘";
  state.rows.push({
    branch: request.branch,
    raw: `${"│ ".repeat(request.indent)}◯${forkTail}${forkEnd}▸${request.branch}`,
  });
}

function pluralizeCommit(count: number): "commit" | "commits" {
  return count === 1 ? "commit" : "commits";
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

function requirePathChild(
  graph: StackGraph,
  children: readonly string[],
  target: string,
): string {
  const child = children.find((candidate) =>
    graph.descendantsOf(candidate).includes(target),
  );
  if (!child) {
    throw new Error(`${target} is not upstack of the current branch`);
  }
  return child;
}
