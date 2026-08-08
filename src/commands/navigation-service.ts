import { ensureNoPausedRestack, trunkOperationError } from "../errors.js";
import { GitRepository } from "../git/git-repository.js";
import { MetadataStore } from "../metadata/metadata-store.js";
import { colors } from "../output/colors.js";
import {
  currentStackBranches,
  renderAllTrunkCheckoutRows,
  renderCheckoutRows,
  type CheckoutChoice,
} from "../output/graph-rows.js";
import { StackGraph } from "../stack/stack-graph.js";
import type { CheckoutRequest } from "./command-controller.js";

export class NavigationService {
  public constructor(
    private readonly repository: GitRepository,
    private readonly store: MetadataStore,
  ) {}

  public checkout(branch: string): void {
    ensureNoPausedRestack(this.store);
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
    ensureNoPausedRestack(this.store);
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
    ensureNoPausedRestack(this.store);
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

  public up(steps: number, target?: string): void {
    ensureNoPausedRestack(this.store);
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
    ensureNoPausedRestack(this.store);
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
    ensureNoPausedRestack(this.store);
    const graph = new StackGraph(this.store.loadMetadata());
    const currentBranch = this.repository.currentBranch();
    console.log(currentBranch);
    const tips = stackTips(graph, currentBranch);
    const branch = requireOnlyUpstackBranch(tips);
    this.repository.checkout(branch);
    this.printCheckout(branch);
  }

  public bottom(): void {
    ensureNoPausedRestack(this.store);
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

  public currentBranch(): string {
    return this.repository.currentBranch();
  }

  public trunkBranch(): string {
    return this.store.loadMetadata().trunk;
  }

  private printCheckout(branch: string): void {
    process.stdout.write(
      `Checked out ${colors.cyan(branch)}.\nThis branch has not yet been submitted.\nRun maol-stack submit to push your changes.\n`,
    );
  }
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
