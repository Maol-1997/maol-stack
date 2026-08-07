import { describe, expect, test } from "vitest";

import { referenceDriver, stacklineDriver } from "./parity-fixture.js";
import {
  runAbortedContentConflict,
  runAddAddConflict,
  runAutomaticContentConflict,
  runAutomaticLateConflict,
  runCleanRestack,
  runDirtyRequiredRestack,
  runDirtyRestack,
  runExplicitContentConflict,
  runModifyDeleteConflict,
  runMultiCommitChild,
  runNoOpRestack,
  runResolvedContentConflict,
  runUnresolvedContentConflict,
} from "./restack-scenarios.js";

describe("Reference CLI restack parity", () => {
  test("matches a clean descendant restack", () => {
    expect(runCleanRestack(stacklineDriver)).toEqual(
      runCleanRestack(referenceDriver),
    );
  });

  test("matches an automatically aborted content conflict", () => {
    expect(runAutomaticContentConflict(stacklineDriver)).toEqual(
      runAutomaticContentConflict(referenceDriver),
    );
  });

  test("matches an automatic conflict after an earlier child restacks", () => {
    expect(runAutomaticLateConflict(stacklineDriver)).toEqual(
      runAutomaticLateConflict(referenceDriver),
    );
  });

  test("matches the paused state of an explicit conflicting restack", () => {
    expect(runExplicitContentConflict(stacklineDriver)).toEqual(
      runExplicitContentConflict(referenceDriver),
    );
  });

  test("matches continue after resolving a content conflict", () => {
    expect(runResolvedContentConflict(stacklineDriver)).toEqual(
      runResolvedContentConflict(referenceDriver),
    );
  });

  test("matches continue before resolving a content conflict", () => {
    expect(runUnresolvedContentConflict(stacklineDriver)).toEqual(
      runUnresolvedContentConflict(referenceDriver),
    );
  });

  test("matches abort after a content conflict", () => {
    expect(runAbortedContentConflict(stacklineDriver)).toEqual(
      runAbortedContentConflict(referenceDriver),
    );
  });

  test("matches an add/add conflict", () => {
    expect(runAddAddConflict(stacklineDriver)).toEqual(
      runAddAddConflict(referenceDriver),
    );
  });

  test("matches a modify/delete conflict", () => {
    expect(runModifyDeleteConflict(stacklineDriver)).toEqual(
      runModifyDeleteConflict(referenceDriver),
    );
  });

  test("matches restacking a child with multiple commits", () => {
    expect(runMultiCommitChild(stacklineDriver)).toEqual(
      runMultiCommitChild(referenceDriver),
    );
  });

  test("matches a no-op restack", () => {
    expect(runNoOpRestack(stacklineDriver)).toEqual(
      runNoOpRestack(referenceDriver),
    );
  });

  test("matches a no-op restack with unstaged changes", () => {
    expect(runDirtyRestack(stacklineDriver, "unstaged")).toEqual(
      runDirtyRestack(referenceDriver, "unstaged"),
    );
  });

  test("matches a no-op restack with staged changes", () => {
    expect(runDirtyRestack(stacklineDriver, "staged")).toEqual(
      runDirtyRestack(referenceDriver, "staged"),
    );
  });

  test("matches an unstaged change when a rebase is required", () => {
    expect(runDirtyRequiredRestack(stacklineDriver, "unstaged")).toEqual(
      runDirtyRequiredRestack(referenceDriver, "unstaged"),
    );
  });
});
