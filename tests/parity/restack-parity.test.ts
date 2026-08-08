import { describe, expect, test } from "vitest";

import { referenceDriver, maolStackDriver } from "./parity-fixture.js";
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
    expect(runCleanRestack(maolStackDriver)).toEqual(
      runCleanRestack(referenceDriver),
    );
  });

  test("matches an automatically aborted content conflict", () => {
    expect(runAutomaticContentConflict(maolStackDriver)).toEqual(
      runAutomaticContentConflict(referenceDriver),
    );
  });

  test("matches an automatic conflict after an earlier child restacks", () => {
    expect(runAutomaticLateConflict(maolStackDriver)).toEqual(
      runAutomaticLateConflict(referenceDriver),
    );
  });

  test("matches the paused state of an explicit conflicting restack", () => {
    expect(runExplicitContentConflict(maolStackDriver)).toEqual(
      runExplicitContentConflict(referenceDriver),
    );
  });

  test("matches continue after resolving a content conflict", () => {
    expect(runResolvedContentConflict(maolStackDriver)).toEqual(
      runResolvedContentConflict(referenceDriver),
    );
  });

  test("matches continue before resolving a content conflict", () => {
    expect(runUnresolvedContentConflict(maolStackDriver)).toEqual(
      runUnresolvedContentConflict(referenceDriver),
    );
  });

  test("matches abort after a content conflict", () => {
    expect(runAbortedContentConflict(maolStackDriver)).toEqual(
      runAbortedContentConflict(referenceDriver),
    );
  });

  test("matches an add/add conflict", () => {
    expect(runAddAddConflict(maolStackDriver)).toEqual(
      runAddAddConflict(referenceDriver),
    );
  });

  test("matches a modify/delete conflict", () => {
    expect(runModifyDeleteConflict(maolStackDriver)).toEqual(
      runModifyDeleteConflict(referenceDriver),
    );
  });

  test("matches restacking a child with multiple commits", () => {
    expect(runMultiCommitChild(maolStackDriver)).toEqual(
      runMultiCommitChild(referenceDriver),
    );
  });

  test("matches a no-op restack", () => {
    expect(runNoOpRestack(maolStackDriver)).toEqual(
      runNoOpRestack(referenceDriver),
    );
  });

  test("matches a no-op restack with unstaged changes", () => {
    expect(runDirtyRestack(maolStackDriver, "unstaged")).toEqual(
      runDirtyRestack(referenceDriver, "unstaged"),
    );
  });

  test("matches a no-op restack with staged changes", () => {
    expect(runDirtyRestack(maolStackDriver, "staged")).toEqual(
      runDirtyRestack(referenceDriver, "staged"),
    );
  });

  test("matches an unstaged change when a rebase is required", () => {
    expect(runDirtyRequiredRestack(maolStackDriver, "unstaged")).toEqual(
      runDirtyRequiredRestack(referenceDriver, "unstaged"),
    );
  });
});
