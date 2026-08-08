import type { RepositoryMetadata } from "../metadata/schemas.js";
import { configuredTrunks } from "../metadata/trunks.js";
import type { StackGraph } from "../stack/stack-graph.js";

export type CheckoutChoice = {
  readonly title: string;
  readonly value: string;
};

type GraphRenderingState = {
  maximumIndent: number;
  readonly rows: Array<{ readonly branch: string; readonly raw: string }>;
};

type GraphBranchRequest = {
  readonly branch: string;
  readonly includedBranches: ReadonlySet<string>;
  readonly indent: number;
};

export function currentStackBranches(
  graph: StackGraph,
  trunk: string,
  currentBranch: string,
): string[] {
  const ancestors = graph.ancestorsOf(currentBranch);
  const descendants = graph.descendantsOf(currentBranch);
  return [...new Set([trunk, ...ancestors, ...descendants])].reverse();
}

export function renderCheckoutRows(
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

export function renderAllTrunkCheckoutRows(
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
