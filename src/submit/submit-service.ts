import { GitRepository } from "../git/git-repository.js";
import { ensureNoPausedRestack, untrackedBranchError } from "../errors.js";
import type {
  CreatePullRequestRequest,
  PullRequest,
  PullRequestHost,
} from "../github/pull-request-host.js";
import { MetadataStore } from "../metadata/metadata-store.js";
import type {
  BranchMetadata,
  RepositoryMetadata,
} from "../metadata/schemas.js";
import { brightBlue, colors } from "../output/colors.js";
import { StackGraph } from "../stack/stack-graph.js";

export type SubmitRequest = {
  readonly branch: string;
  readonly creationPolicy: "existing-only" | "include-new";
  readonly execution: "apply" | "dry-run";
  readonly interaction: "interactive" | "non-interactive";
  readonly publication: "draft" | "ready";
  readonly publicationSelection: "default" | "explicit";
  readonly pushMode: "force" | "lease";
  readonly remote: string;
  readonly scope: "current-chain" | "whole-stack";
  readonly trunkPolicy: "ignore-out-of-sync" | "require-synced";
};

type BranchSubmission = {
  readonly branch: string;
  readonly localRevision: string;
  readonly parent: string;
  readonly remoteRevision?: string;
};

type SubmissionPlan = {
  readonly emptyBranches: readonly string[];
  readonly submissions: readonly BranchSubmission[];
};

type PreparedSubmission = {
  readonly action: "Create" | "Sync to GitHub" | "Update";
  readonly pullRequest?: PullRequest;
  readonly submission: BranchSubmission;
};

export class SubmitService {
  public constructor(
    private readonly repository: GitRepository,
    private readonly store: MetadataStore,
    private readonly pullRequests: PullRequestHost,
  ) {}

  public submit(request: SubmitRequest, prepareBranches?: () => void): void {
    ensureNoPausedRestack(this.store);
    let metadata = this.store.loadMetadata();
    this.validateSelectedBranch(metadata, request.branch);
    this.printExecutionMode(request);
    console.log(
      brightBlue("🥞 Validating that this stack is ready to submit..."),
    );
    prepareBranches?.();
    metadata = this.store.loadMetadata();
    this.pullRequests.validateRepository();
    this.validateTrunk(metadata, request);
    const plan = this.prepareSubmissionPlan(metadata, request);
    this.printEmptyBranches(plan.emptyBranches);
    if (plan.submissions.length === 0) {
      console.log("Nothing to submit!");
      return;
    }
    const preparedSubmissions = plan.submissions
      .map((submission) =>
        this.preparePullRequestSubmission(metadata, submission),
      )
      .filter(
        ({ pullRequest }) =>
          request.creationPolicy === "include-new" || Boolean(pullRequest),
      );
    if (preparedSubmissions.length === 0) {
      console.log("Nothing to submit!");
      return;
    }
    this.printPreparedSubmissions(preparedSubmissions);
    if (request.execution === "dry-run") {
      console.log(brightBlue("✅ Dry run complete."));
      return;
    }
    console.log("🚀 Pushing branches to remote...");
    for (const preparedSubmission of preparedSubmissions) {
      this.pushBranch({ metadata, request, preparedSubmission });
    }
    process.stdout.write("\n📨 Creating/updating PRs...\n");
    for (const preparedSubmission of preparedSubmissions) {
      this.submitPullRequest({ metadata, request, preparedSubmission });
    }
  }

  private printExecutionMode(request: SubmitRequest): void {
    if (request.execution === "dry-run") {
      process.stdout.write(
        `${colors.yellow("Running submit in 'dry-run' mode. No branches will be pushed and no PRs will be opened or updated.")}\n\n`,
      );
    }
    if (request.interaction === "non-interactive") {
      const publicationNotice =
        request.publicationSelection === "default"
          ? " and new PRs will be created in draft mode"
          : "";
      process.stdout.write(
        `Running in non-interactive mode. Inline prompts to fill PR fields will be skipped${publicationNotice}.\n\n`,
      );
    }
  }

  private validateTrunk(
    metadata: RepositoryMetadata,
    request: SubmitRequest,
  ): void {
    const remoteRevision = this.repository.remoteBranchRevision(
      request.remote,
      metadata.trunk,
    );
    if (
      remoteRevision &&
      remoteRevision !== this.repository.resolveRevision(metadata.trunk) &&
      request.trunkPolicy === "ignore-out-of-sync"
    ) {
      process.stdout.write(
        `Trunk branch (${metadata.trunk}) is behind its upstream branch.\n` +
          "Failure to update could result in incorrect metadata being used to submit PRs.\n" +
          "You can skip trying to update trunk by re-submitting with --ignore-out-of-sync-trunk\n",
      );
    }
  }

  private validateSelectedBranch(
    metadata: RepositoryMetadata,
    branch: string,
  ): void {
    if (!new StackGraph(metadata).isTracked(branch)) {
      throw untrackedBranchError(branch);
    }
  }

  private prepareSubmissionPlan(
    metadata: RepositoryMetadata,
    request: SubmitRequest,
  ): SubmissionPlan {
    const graph = new StackGraph(metadata);
    if (!graph.isTracked(request.branch)) {
      throw new Error(`branch ${request.branch} is not tracked`);
    }
    const branches = selectBranches(graph, metadata, request);
    if (branches.length === 0) {
      throw new Error("there are no change branches to submit");
    }
    const blockedBranches = new Set<string>();
    const emptyBranches: string[] = [];
    const submissions: BranchSubmission[] = [];
    for (const branch of branches) {
      const branchMetadata = requireBranchMetadata(metadata, branch);
      const introducesChanges = this.repository.hasTreeChanges(
        branchMetadata.parent,
        branch,
      );
      if (!introducesChanges) {
        emptyBranches.push(branch);
        blockedBranches.add(branch);
      } else if (blockedBranches.has(branchMetadata.parent)) {
        blockedBranches.add(branch);
      } else {
        submissions.push(
          this.prepareBranchSubmission(metadata, branch, request),
        );
      }
    }
    return { emptyBranches, submissions };
  }

  private preparePullRequestSubmission(
    metadata: RepositoryMetadata,
    submission: BranchSubmission,
  ): PreparedSubmission {
    const pullRequest = this.pullRequests.findOpenPullRequest(
      submission.branch,
    );
    if (!pullRequest) {
      return { action: "Create", submission };
    }
    const branchMetadata = requireBranchMetadata(metadata, submission.branch);
    return {
      action: branchMetadata.submission?.pullRequest
        ? "Update"
        : "Sync to GitHub",
      pullRequest,
      submission,
    };
  }

  private prepareBranchSubmission(
    metadata: RepositoryMetadata,
    branch: string,
    request: SubmitRequest,
  ): BranchSubmission {
    const branchMetadata = requireBranchMetadata(metadata, branch);
    const localRevision = this.repository.resolveRevision(branch);
    const parentRevision = this.repository.resolveRevision(
      branchMetadata.parent,
    );
    if (!this.repository.isAncestor(parentRevision, localRevision)) {
      throw new Error(
        `${branch} is not restacked on ${branchMetadata.parent}; run maol-stack restack first`,
      );
    }
    const remoteRevision = this.repository.remoteBranchRevision(
      request.remote,
      branch,
    );
    this.validateRemoteRevision({
      branch,
      branchMetadata,
      remote: request.remote,
      remoteRevision,
      pushMode: request.pushMode,
      localRevision,
    });
    return {
      branch,
      localRevision,
      parent: branchMetadata.parent,
      remoteRevision,
    };
  }

  private validateRemoteRevision(input: {
    readonly branch: string;
    readonly branchMetadata: BranchMetadata;
    readonly localRevision: string;
    readonly pushMode: "force" | "lease";
    readonly remote: string;
    readonly remoteRevision?: string;
  }): void {
    if (input.pushMode === "force" || !input.remoteRevision) {
      return;
    }
    const previousSubmission = input.branchMetadata.submission;
    const knownRemoteRevision =
      previousSubmission?.remote === input.remote
        ? previousSubmission.remoteRevision
        : undefined;
    if (!knownRemoteRevision && input.remoteRevision !== input.localRevision) {
      throw new Error(
        `remote branch ${input.remote}/${input.branch} already exists and was not submitted by maol-stack; use --force to overwrite it`,
      );
    }
    if (knownRemoteRevision && knownRemoteRevision !== input.remoteRevision) {
      throw new Error(
        `remote branch ${input.remote}/${input.branch} changed since the last submit; fetch or use --force after reviewing it`,
      );
    }
  }

  private pushBranch(input: {
    readonly metadata: RepositoryMetadata;
    readonly preparedSubmission: PreparedSubmission;
    readonly request: SubmitRequest;
  }): void {
    const { submission } = input.preparedSubmission;
    this.repository.pushBranch({
      branch: submission.branch,
      expectedRemoteRevision: submission.remoteRevision,
      mode: input.request.pushMode,
      remote: input.request.remote,
    });
    this.recordRemotePush({
      metadata: input.metadata,
      request: input.request,
      submission,
    });
  }

  private submitPullRequest(input: {
    readonly metadata: RepositoryMetadata;
    readonly preparedSubmission: PreparedSubmission;
    readonly request: SubmitRequest;
  }): void {
    const { pullRequest, submission } = input.preparedSubmission;
    const submittedPullRequest = this.createOrUpdatePullRequest(
      submission,
      input.request,
      pullRequest,
    );
    this.recordPullRequest(
      { metadata: input.metadata, submission },
      submittedPullRequest,
    );
    const result = pullRequest ? "updated" : "created";
    console.log(
      `${submission.branch}: ${submittedPullRequest.url} (${result})`,
    );
  }

  private createOrUpdatePullRequest(
    submission: BranchSubmission,
    request: SubmitRequest,
    existingPullRequest?: PullRequest,
  ): PullRequest {
    if (!existingPullRequest) {
      return this.pullRequests.createPullRequest(
        this.createPullRequestRequest(submission, request),
      );
    }
    return existingPullRequest.base === submission.parent
      ? existingPullRequest
      : this.pullRequests.updatePullRequestBase(
          existingPullRequest,
          submission.parent,
        );
  }

  private createPullRequestRequest(
    submission: BranchSubmission,
    request: SubmitRequest,
  ): CreatePullRequestRequest {
    return {
      base: submission.parent,
      branch: submission.branch,
      publication: request.publication,
      title: this.repository.commitSubject(submission.branch),
    };
  }

  private recordRemotePush(input: {
    readonly metadata: RepositoryMetadata;
    readonly request: SubmitRequest;
    readonly submission: BranchSubmission;
  }): void {
    const branchMetadata = requireBranchMetadata(
      input.metadata,
      input.submission.branch,
    );
    branchMetadata.submission = {
      remote: input.request.remote,
      remoteRevision: input.submission.localRevision,
      pullRequest: branchMetadata.submission?.pullRequest,
    };
    this.store.saveMetadata(input.metadata);
  }

  private recordPullRequest(
    input: {
      readonly metadata: RepositoryMetadata;
      readonly submission: BranchSubmission;
    },
    pullRequest: PullRequest,
  ): void {
    const branchMetadata = requireBranchMetadata(
      input.metadata,
      input.submission.branch,
    );
    if (!branchMetadata.submission) {
      throw new Error(
        `submission state is missing for ${input.submission.branch}`,
      );
    }
    branchMetadata.submission.pullRequest = pullRequest;
    this.store.saveMetadata(input.metadata);
  }

  private printEmptyBranches(emptyBranches: readonly string[]): void {
    if (emptyBranches.length === 0) {
      return;
    }
    if (emptyBranches.length === 1) {
      process.stderr.write(
        "WARNING: This branch does not introduce any changes:\n",
      );
      process.stdout.write(`▸ ${emptyBranches[0]}\n`);
      process.stderr.write(
        "WARNING: This branch and any dependent branches will not be submitted, as GitHub does not allow empty PRs.\n" +
          "WARNING: In order to submit, commit some changes to it or delete it and try again.\n",
      );
      return;
    }
    process.stderr.write(
      "WARNING: The following branches do not introduce any changes:\n",
    );
    process.stdout.write(
      `${emptyBranches.map((branch) => `▸ ${branch}`).join("\n")}\n`,
    );
    process.stderr.write(
      "WARNING: These branches and any dependent branches will not be submitted, as GitHub does not allow empty PRs.\n" +
        "WARNING: In order to submit, commit some changes to them or delete them and try again.\n",
    );
  }

  private printPreparedSubmissions(
    preparedSubmissions: readonly PreparedSubmission[],
  ): void {
    process.stdout.write(
      `\n${brightBlue("📝 Preparing to submit PRs for the following branches...")}\n` +
        preparedSubmissions
          .map(
            ({ action, submission }) =>
              `▸ ${colors.cyan(submission.branch)} (${action})`,
          )
          .join("\n") +
        "\n\n",
    );
  }
}

function selectBranches(
  graph: StackGraph,
  metadata: RepositoryMetadata,
  request: SubmitRequest,
): string[] {
  const ancestors = graph.ancestorsOf(request.branch);
  if (request.scope === "current-chain") {
    return ancestors;
  }
  const descendants = graph.descendantsOf(request.branch);
  const branches =
    request.branch === metadata.trunk
      ? descendants
      : [...ancestors, ...descendants];
  return [...new Set(branches)];
}

function requireBranchMetadata(
  metadata: RepositoryMetadata,
  branch: string,
): BranchMetadata {
  const branchMetadata = metadata.branches[branch];
  if (!branchMetadata) {
    throw new Error(`branch ${branch} is not a tracked change branch`);
  }
  return branchMetadata;
}
