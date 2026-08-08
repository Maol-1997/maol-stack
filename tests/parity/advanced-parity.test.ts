import { describe, expect, test } from "vitest";

import { referenceDriver, maolStackDriver } from "./parity-fixture.js";
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
    expect(runDirtyRequiredRestack(maolStackDriver, "staged")).toEqual(
      runDirtyRequiredRestack(referenceDriver, "staged"),
    );
  });

  test("matches a branch checked out in another worktree", () => {
    expect(runWorktreeConflict(maolStackDriver)).toEqual(
      runWorktreeConflict(referenceDriver),
    );
  });

  test("matches moving a branch downstack", () => {
    expect(runMove(maolStackDriver)).toEqual(runMove(referenceDriver));
  });

  test("matches moving only one branch while detaching descendants", () => {
    expect(runMoveOnly(maolStackDriver)).toEqual(runMoveOnly(referenceDriver));
  });

  test("matches squashing a branch with multiple commits", () => {
    expect(runSquash(maolStackDriver)).toEqual(runSquash(referenceDriver));
  });

  test("matches creating and restacking an empty branch", () => {
    expect(runEmptyBranch(maolStackDriver)).toEqual(
      runEmptyBranch(referenceDriver),
    );
  });

  test("matches undoing a completed restack", () => {
    expect(runRestackUndo(maolStackDriver)).toEqual(
      runRestackUndo(referenceDriver),
    );
  });

  test("matches undoing modify and its automatic restack", () => {
    expect(runModifyUndo(maolStackDriver)).toEqual(
      runModifyUndo(referenceDriver),
    );
  });

  test("matches consecutive conflicts while continuing upstack", () => {
    expect(runConsecutiveConflicts(maolStackDriver)).toEqual(
      runConsecutiveConflicts(referenceDriver),
    );
  });

  test("matches a conflict when unrelated changes are staged", () => {
    expect(runStagedConflict(maolStackDriver)).toEqual(
      runStagedConflict(referenceDriver),
    );
  });
});
