import { describe, expect, test } from "vitest";

import { referenceDriver, stacklineDriver } from "./parity-fixture.js";
import {
  runConsecutiveConflicts,
  runDirtyRequiredRestack,
  runEmptyBranch,
  runModifyUndo,
  runMove,
  runMoveOnly,
  runRestackUndo,
  runSquash,
  runStagedConflict,
  runWorktreeConflict,
} from "./restack-scenarios.js";

describe("Reference CLI advanced parity", () => {
  test("matches a staged change when a rebase is required", () => {
    expect(runDirtyRequiredRestack(stacklineDriver, "staged")).toEqual(
      runDirtyRequiredRestack(referenceDriver, "staged"),
    );
  });

  test("matches a branch checked out in another worktree", () => {
    expect(runWorktreeConflict(stacklineDriver)).toEqual(
      runWorktreeConflict(referenceDriver),
    );
  });

  test("matches moving a branch downstack", () => {
    expect(runMove(stacklineDriver)).toEqual(runMove(referenceDriver));
  });

  test("matches moving only one branch while detaching descendants", () => {
    expect(runMoveOnly(stacklineDriver)).toEqual(runMoveOnly(referenceDriver));
  });

  test("matches squashing a branch with multiple commits", () => {
    expect(runSquash(stacklineDriver)).toEqual(runSquash(referenceDriver));
  });

  test("matches creating and restacking an empty branch", () => {
    expect(runEmptyBranch(stacklineDriver)).toEqual(
      runEmptyBranch(referenceDriver),
    );
  });

  test("matches undoing a completed restack", () => {
    expect(runRestackUndo(stacklineDriver)).toEqual(
      runRestackUndo(referenceDriver),
    );
  });

  test("matches undoing modify and its automatic restack", () => {
    expect(runModifyUndo(stacklineDriver)).toEqual(
      runModifyUndo(referenceDriver),
    );
  });

  test("matches consecutive conflicts while continuing upstack", () => {
    expect(runConsecutiveConflicts(stacklineDriver)).toEqual(
      runConsecutiveConflicts(referenceDriver),
    );
  });

  test("matches a conflict when unrelated changes are staged", () => {
    expect(runStagedConflict(stacklineDriver)).toEqual(
      runStagedConflict(referenceDriver),
    );
  });
});
