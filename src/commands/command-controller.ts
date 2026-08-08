import { GitRepository } from "../git/git-repository.js";
import {
  GitHubCli,
  type PullRequestHost,
} from "../github/pull-request-host.js";
import { MetadataStore } from "../metadata/metadata-store.js";
import { configuredTrunks } from "../metadata/trunks.js";
import type { CheckoutChoice } from "../output/graph-rows.js";
import { StackRenderer, type LogRequest } from "../output/stack-renderer.js";
import {
  RestackService,
  type RestackRequest,
} from "../stack/restack-service.js";
import { SubmitService, type SubmitRequest } from "../submit/submit-service.js";
import { MutationService } from "./mutation-service.js";
import { NavigationService } from "./navigation-service.js";
import { TrackingService } from "./tracking-service.js";

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

export type CheckoutRequest = {
  readonly acrossTrunks: boolean;
  readonly includeUntracked: boolean;
  readonly scope: "all" | "current-stack";
};

export type WorkingChanges = {
  readonly staged: boolean;
  readonly tracked: boolean;
  readonly untracked: boolean;
};

export class CommandController {
  private readonly restacks: RestackService;
  private readonly submissions: SubmitService;
  private readonly tracking: TrackingService;
  private readonly mutations: MutationService;
  private readonly navigation: NavigationService;

  public constructor(
    private readonly repository: GitRepository,
    private readonly store: MetadataStore,
    pullRequests: PullRequestHost = new GitHubCli(repository.root),
  ) {
    this.restacks = new RestackService(repository, store);
    this.submissions = new SubmitService(repository, store, pullRequests);
    this.tracking = new TrackingService(repository, store);
    this.mutations = new MutationService(repository, store, this.restacks);
    this.navigation = new NavigationService(repository, store);
  }

  public initialize(
    trunk?: string,
    mode: "preserve" | "reset" = "preserve",
  ): void {
    this.tracking.initialize(trunk, mode);
  }

  public printInitializationPrelude(): void {
    this.tracking.printInitializationPrelude();
  }

  public initializeAfterPrelude(
    trunk?: string,
    mode: "preserve" | "reset" = "preserve",
  ): void {
    this.tracking.initializeAfterPrelude(trunk, mode);
  }

  public initializationBranches(): string[] {
    return this.tracking.initializationBranches();
  }

  public inferredTrunk(): string | undefined {
    return this.tracking.inferredTrunk();
  }

  public ensureInitialized(): void {
    this.tracking.ensureInitialized();
  }

  public track(
    branch?: string,
    parent?: string,
    mode: "explicit" | "nearest-ancestor" | "recursive" = "explicit",
  ): void {
    this.tracking.track(branch, parent, mode);
  }

  public trackParentChoices(branch?: string): string[] {
    return this.tracking.trackParentChoices(branch);
  }

  public isTracked(branch: string): boolean {
    return this.tracking.isTracked(branch);
  }

  public untrackChildren(branch?: string): string[] {
    return this.tracking.untrackChildren(branch);
  }

  public untrack(
    branch: string | undefined,
    mode: "confirm" | "confirmed" | "force",
  ): void {
    this.tracking.untrack(branch, mode);
  }

  public create(request: CreateRequest): void {
    this.mutations.create(request);
  }

  public modify(request: ModifyRequest): void {
    this.mutations.modify(request);
  }

  public restack(request: RestackRequest): void {
    this.restacks.start(request);
  }

  public interactiveRebase(): void {
    this.mutations.interactiveRebase();
  }

  public move(request: MoveRequest): void {
    this.mutations.move(request);
  }

  public squash(message?: string): void {
    this.mutations.squash(message);
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
    this.navigation.checkout(branch);
  }

  public checkoutChoices(request: CheckoutRequest): CheckoutChoice[] {
    return this.navigation.checkoutChoices(request);
  }

  public moveChoices(
    branch?: string,
    scope: "active-trunk" | "all-trunks" = "active-trunk",
  ): CheckoutChoice[] {
    return this.navigation.moveChoices(branch, scope);
  }

  public workingChanges(): WorkingChanges {
    return this.mutations.workingChanges();
  }

  public trackedChildren(branch: string): string[] {
    return this.tracking.trackedChildren(branch);
  }

  public isTrunk(branch: string): boolean {
    return this.tracking.isTrunk(branch);
  }

  public insertChildren(
    previousParent: string,
    newParent: string,
    children: readonly string[],
  ): void {
    this.mutations.insertChildren(previousParent, newParent, children);
  }

  public restoreIndexAfterCancelledMutation(): void {
    this.mutations.restoreIndexAfterCancelledMutation();
  }

  public up(steps: number, target?: string): void {
    this.navigation.up(steps, target);
  }

  public down(steps: number): void {
    this.navigation.down(steps);
  }

  public top(): void {
    this.navigation.top();
  }

  public bottom(): void {
    this.navigation.bottom();
  }

  public printParent(): void {
    this.navigation.printParent();
  }

  public printChildren(): void {
    this.navigation.printChildren();
  }

  public printTrunk(scope: "active" | "all" = "active"): void {
    this.tracking.printTrunk(scope);
  }

  public addTrunk(branch: string): void {
    this.tracking.addTrunk(branch);
  }

  public add(paths: readonly string[]): void {
    this.mutations.add(paths);
  }

  public currentBranch(): string {
    return this.navigation.currentBranch();
  }

  public trunkBranch(): string {
    return this.navigation.trunkBranch();
  }
}
