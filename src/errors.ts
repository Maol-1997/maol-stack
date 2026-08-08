import type { GitRepository } from "./git/git-repository.js";
import type { MetadataStore } from "./metadata/metadata-store.js";

export function ensureNoPausedRestack(store: MetadataStore): void {
  if (store.loadOperation()) {
    throw new Error(
      "a restack is paused; run maol-stack continue or maol-stack abort first",
    );
  }
}

export function requireExistingBranch(
  repository: GitRepository,
  branch: string,
): void {
  if (!repository.branchExists(branch)) {
    throw new Error(`Could not find branch ${branch}.`);
  }
}

export function trunkOperationError(branch?: string): Error {
  const context = branch ? `\n\n${branch}` : "";
  return new Error(
    `Cannot perform this operation on the trunk branch.${context}`,
  );
}

export function untrackedBranchError(branch: string): Error {
  return new Error(
    `Cannot perform this operation on untracked branch ${branch}.\n` +
      "You can track it by specifying its parent with maol-stack track.",
  );
}
