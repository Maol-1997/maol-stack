import type { RepositoryMetadata } from "../metadata/schemas.js";
import { configuredTrunks } from "../metadata/trunks.js";

export class StackGraph {
  public constructor(private readonly metadata: RepositoryMetadata) {}

  public isTracked(branch: string): boolean {
    return this.isTrunk(branch) || branch in this.metadata.branches;
  }

  public parentOf(branch: string): string | undefined {
    return this.isTrunk(branch)
      ? undefined
      : this.metadata.branches[branch]?.parent;
  }

  public childrenOf(parent: string): string[] {
    return Object.entries(this.metadata.branches)
      .filter(([, branchMetadata]) => branchMetadata.parent === parent)
      .map(([branch]) => branch)
      .sort();
  }

  public ancestorsOf(branch: string): string[] {
    const ancestors: string[] = [];
    const visited = new Set<string>();
    let currentBranch = branch;
    while (!this.isTrunk(currentBranch)) {
      if (visited.has(currentBranch)) {
        throw new Error(`cycle detected while traversing ${branch}`);
      }
      visited.add(currentBranch);
      const parent = this.parentOf(currentBranch);
      if (!parent) {
        throw new Error(`branch ${currentBranch} is not connected to trunk`);
      }
      ancestors.push(currentBranch);
      currentBranch = parent;
    }
    return ancestors.reverse();
  }

  public descendantsOf(branch: string): string[] {
    return this.collectDescendants(branch, new Set<string>());
  }

  public validate(): void {
    for (const branch of Object.keys(this.metadata.branches)) {
      this.ancestorsOf(branch);
    }
  }

  public isTrunk(branch: string): boolean {
    return configuredTrunks(this.metadata).includes(branch);
  }

  private collectDescendants(branch: string, path: Set<string>): string[] {
    if (path.has(branch)) {
      throw new Error(`cycle detected at branch ${branch}`);
    }
    const descendantPath = new Set(path).add(branch);
    const descendants = this.isTrunk(branch) ? [] : [branch];
    for (const child of this.childrenOf(branch)) {
      descendants.push(...this.collectDescendants(child, descendantPath));
    }
    return descendants;
  }
}
