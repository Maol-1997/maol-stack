import type { RepositoryMetadata } from "./schemas.js";

export const COMMON_TRUNK_NAMES: readonly string[] = [
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

export function configuredTrunks(metadata: RepositoryMetadata): string[] {
  return [...new Set([...(metadata.trunks ?? []), metadata.trunk])];
}

export function trunkForBranch(
  metadata: RepositoryMetadata,
  branch: string | undefined,
): string {
  if (!branch) {
    return metadata.trunk;
  }
  const trunks = new Set(configuredTrunks(metadata));
  const visited = new Set<string>();
  let candidate = branch;
  while (!trunks.has(candidate)) {
    if (visited.has(candidate)) {
      return metadata.trunk;
    }
    visited.add(candidate);
    const parent = metadata.branches[candidate]?.parent;
    if (!parent) {
      return metadata.trunk;
    }
    candidate = parent;
  }
  return candidate;
}
