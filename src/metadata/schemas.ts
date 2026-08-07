import { z } from "zod";

export const pullRequestMetadataSchema = z.object({
  number: z.number().int().positive(),
  url: z.string().url(),
  base: z.string().min(1),
});

export const submissionMetadataSchema = z.object({
  remote: z.string().min(1),
  remoteRevision: z.string().min(1),
  pullRequest: pullRequestMetadataSchema.optional(),
});

export const branchMetadataSchema = z.object({
  parent: z.string().min(1),
  base: z.string().min(1),
  restackRequired: z.literal(true).optional(),
  submission: submissionMetadataSchema.optional(),
});

export const repositoryMetadataSchema = z.object({
  version: z.literal(1),
  trunk: z.string().min(1),
  trunks: z.array(z.string().min(1)).optional(),
  branches: z.record(z.string(), branchMetadataSchema),
});

export const restackOperationSchema = z.object({
  originalBranch: z.string().min(1),
  activeBranch: z.string().min(1).optional(),
  pendingBranches: z.array(z.string().min(1)),
  completedBranches: z.array(z.string().min(1)),
  snapshotId: z.string().min(1),
  stagedChangesStash: z.string().min(1).optional(),
});

export const undoSnapshotSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  originalBranch: z.string().min(1),
  metadata: repositoryMetadataSchema,
  branchRevisions: z.record(z.string(), z.string().min(1)),
  workingTreePatch: z.string().min(1).optional(),
});

export const undoHistorySchema = z.array(undoSnapshotSchema);

export type BranchMetadata = z.infer<typeof branchMetadataSchema>;
export type RepositoryMetadata = z.infer<typeof repositoryMetadataSchema>;
export type RestackOperation = z.infer<typeof restackOperationSchema>;
export type UndoSnapshot = z.infer<typeof undoSnapshotSchema>;
