import { existsSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { GitRepository } from "../git/git-repository.js";
import { StackGraph } from "../stack/stack-graph.js";
import { readValidatedJson, writeJsonAtomically } from "./json-file.js";
import {
  repositoryMetadataSchema,
  restackOperationSchema,
  undoHistorySchema,
  type RepositoryMetadata,
  type RestackOperation,
  type UndoSnapshot,
} from "./schemas.js";
import { configuredTrunks, trunkForBranch } from "./trunks.js";

const MAX_UNDO_SNAPSHOTS = 20;
const DIRECTORY_NAME = "maol-stack";
const LEGACY_DIRECTORY_NAME = "stackline";

export class MetadataStore {
  private readonly metadataPath: string;
  private readonly operationPath: string;
  private readonly undoHistoryPath: string;

  public constructor(private readonly repository: GitRepository) {
    adoptLegacyDirectory(repository.commonGitDirectory);
    adoptLegacyDirectory(repository.gitDirectory);
    this.metadataPath = join(
      repository.commonGitDirectory,
      DIRECTORY_NAME,
      "metadata.json",
    );
    this.operationPath = join(
      repository.gitDirectory,
      DIRECTORY_NAME,
      "operation.json",
    );
    this.undoHistoryPath = join(
      repository.gitDirectory,
      DIRECTORY_NAME,
      "undo.json",
    );
  }

  public isInitialized(): boolean {
    return existsSync(this.metadataPath);
  }

  public loadMetadata(): RepositoryMetadata {
    if (!this.isInitialized()) {
      throw new Error("repository is not initialized; run maol-stack init");
    }
    const metadata = readValidatedJson(
      this.metadataPath,
      repositoryMetadataSchema,
    );
    metadata.trunk = trunkForBranch(
      metadata,
      this.repository.tryCurrentBranch(),
    );
    new StackGraph(metadata).validate();
    return metadata;
  }

  public saveMetadata(metadata: RepositoryMetadata): void {
    repositoryMetadataSchema.parse(metadata);
    new StackGraph(metadata).validate();
    writeJsonAtomically(this.metadataPath, metadata);
  }

  public loadOperation(): RestackOperation | undefined {
    return existsSync(this.operationPath)
      ? readValidatedJson(this.operationPath, restackOperationSchema)
      : undefined;
  }

  public saveOperation(operation: RestackOperation): void {
    writeJsonAtomically(
      this.operationPath,
      restackOperationSchema.parse(operation),
    );
  }

  public clearOperation(): void {
    if (existsSync(this.operationPath)) {
      unlinkSync(this.operationPath);
    }
  }

  public captureSnapshot(
    metadata: RepositoryMetadata,
    label: string,
  ): UndoSnapshot {
    const branchRevisions = this.captureTrackedBranchRevisions(metadata);
    const snapshot: UndoSnapshot = {
      id: randomUUID(),
      label,
      originalBranch: this.repository.currentBranch(),
      metadata: structuredClone(metadata),
      branchRevisions,
      workingTreePatch: optionalText(this.repository.workingTreePatch()),
    };
    const history = [...this.loadUndoHistory(), snapshot].slice(
      -MAX_UNDO_SNAPSHOTS,
    );
    this.saveUndoHistory(history);
    return snapshot;
  }

  public findSnapshot(id: string): UndoSnapshot {
    const snapshot = this.loadUndoHistory().find(
      (candidate) => candidate.id === id,
    );
    if (!snapshot) {
      throw new Error(`undo snapshot ${id} was not found`);
    }
    return snapshot;
  }

  public popSnapshot(): UndoSnapshot {
    const history = this.loadUndoHistory();
    const snapshot = history.pop();
    if (!snapshot) {
      throw new Error("Could not find a maol-stack mutation to undo...");
    }
    this.saveUndoHistory(history);
    return snapshot;
  }

  public discardSnapshot(id: string): void {
    this.saveUndoHistory(
      this.loadUndoHistory().filter((snapshot) => snapshot.id !== id),
    );
  }

  private captureTrackedBranchRevisions(
    metadata: RepositoryMetadata,
  ): Record<string, string> {
    const trackedBranches = [
      ...configuredTrunks(metadata),
      ...Object.keys(metadata.branches),
    ];
    return Object.fromEntries(
      trackedBranches
        .filter((branch) => this.repository.branchExists(branch))
        .map((branch) => [branch, this.repository.resolveRevision(branch)]),
    );
  }

  private loadUndoHistory(): UndoSnapshot[] {
    return existsSync(this.undoHistoryPath)
      ? readValidatedJson(this.undoHistoryPath, undoHistorySchema)
      : [];
  }

  private saveUndoHistory(history: readonly UndoSnapshot[]): void {
    writeJsonAtomically(this.undoHistoryPath, history);
  }
}

function optionalText(value: string): string | undefined {
  return value.length > 0 ? value : undefined;
}

// Repositories initialized before the rename store their state under the
// previous product name. Adopt that directory instead of reinitializing.
function adoptLegacyDirectory(gitDirectory: string): void {
  const legacyDirectory = join(gitDirectory, LEGACY_DIRECTORY_NAME);
  const currentDirectory = join(gitDirectory, DIRECTORY_NAME);
  if (existsSync(legacyDirectory) && !existsSync(currentDirectory)) {
    renameSync(legacyDirectory, currentDirectory);
  }
}
