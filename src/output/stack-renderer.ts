import type { GitRepository } from "../git/git-repository.js";
import type { RepositoryMetadata } from "../metadata/schemas.js";
import { configuredTrunks } from "../metadata/trunks.js";
import { StackGraph } from "../stack/stack-graph.js";
import {
  currentStackBranches,
  renderCheckoutRows,
  type CheckoutChoice,
} from "./graph-rows.js";

export type LogRequest = {
  readonly acrossTrunks: boolean;
  readonly classic: boolean;
  readonly format: "default" | "long" | "short";
  readonly includeUntracked: boolean;
  readonly reverse: boolean;
  readonly scope: "all" | "current-stack";
  readonly steps?: number;
};

export class StackRenderer {
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
        ? currentStackBranches(this.graph, this.metadata.trunk, currentBranch)
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
