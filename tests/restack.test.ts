import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { RestackConflictError } from "../src/stack/restack-service.js";
import { GitFixture } from "./helpers/git-fixture.js";

describe("restack", () => {
  let fixture: GitFixture;

  beforeEach(() => {
    fixture = new GitFixture();
    fixture.controller.initialize("main");
  });

  afterEach(() => {
    fixture.dispose();
  });

  test("rebases every descendant after a parent is amended", () => {
    fixture.controller.create({ name: "first", stageMode: "staged" });
    fixture.commitEmpty("first");
    fixture.controller.create({ name: "second", stageMode: "staged" });
    fixture.commitEmpty("second");
    fixture.controller.create({ name: "third", stageMode: "staged" });
    fixture.commitEmpty("third");
    const previousSecond = fixture.repository.resolveRevision("second");
    const previousThird = fixture.repository.resolveRevision("third");

    fixture.controller.checkout("first");
    fixture.amendEmpty("first amended");
    fixture.controller.restack({ branch: "first", scope: "upstack" });

    expect(fixture.repository.resolveRevision("second")).not.toBe(
      previousSecond,
    );
    expect(fixture.repository.resolveRevision("third")).not.toBe(previousThird);
    expect(fixture.repository.isAncestor("first", "second")).toBe(true);
    expect(fixture.repository.isAncestor("second", "third")).toBe(true);
  });

  test("abort restores branch tips saved before a conflicted restack", () => {
    createConflictingStack(fixture);
    const previousSecond = fixture.repository.resolveRevision("second");

    expect(() =>
      fixture.controller.restack({ branch: "first", scope: "upstack" }),
    ).toThrow(RestackConflictError);
    expect(fixture.store.loadOperation()).toBeDefined();
    fixture.controller.abort();

    expect(fixture.repository.resolveRevision("second")).toBe(previousSecond);
    expect(fixture.store.loadOperation()).toBeUndefined();
    expect(fixture.repository.rebaseInProgress()).toBe(false);
  });

  test("continue completes descendants after resolving a conflict", () => {
    createConflictingStack(fixture);
    expect(() =>
      fixture.controller.restack({ branch: "first", scope: "upstack" }),
    ).toThrow(RestackConflictError);

    fixture.write("shared.txt", "resolved\n");
    fixture.controller.continueWithAllChanges();

    expect(fixture.store.loadOperation()).toBeUndefined();
    expect(fixture.repository.isAncestor("first", "second")).toBe(true);
    fixture.controller.checkout("second");
    expect(fixture.read("shared.txt")).toBe("resolved\n");
  });

  test("undo restores branch tips from before a completed restack", () => {
    fixture.controller.create({ name: "first", stageMode: "staged" });
    fixture.commitEmpty("first");
    fixture.controller.create({ name: "second", stageMode: "staged" });
    fixture.commitEmpty("second");
    const previousSecond = fixture.repository.resolveRevision("second");
    fixture.controller.checkout("first");
    fixture.amendEmpty("first amended");
    fixture.controller.restack({ branch: "first", scope: "upstack" });

    fixture.controller.undo();

    expect(fixture.repository.resolveRevision("second")).toBe(previousSecond);
  });

  test("modify amends a middle branch and automatically restacks its child", () => {
    fixture.write("parent.txt", "first\n");
    fixture.controller.create({
      name: "first",
      message: "first",
      stageMode: "all",
    });
    fixture.write("child.txt", "second\n");
    fixture.controller.create({
      name: "second",
      message: "second",
      stageMode: "all",
    });
    const previousSecond = fixture.repository.resolveRevision("second");
    fixture.controller.checkout("first");
    fixture.write("parent.txt", "first updated\n");

    fixture.controller.modify({ commitMode: "amend", stageMode: "all" });

    expect(fixture.repository.resolveRevision("second")).not.toBe(
      previousSecond,
    );
    expect(fixture.repository.isAncestor("first", "second")).toBe(true);
  });

  test("move reparents a branch and restacks its descendants", () => {
    fixture.controller.create({ name: "first", stageMode: "staged" });
    fixture.commitEmpty("first");
    fixture.controller.create({ name: "second", stageMode: "staged" });
    fixture.commitEmpty("second");
    fixture.controller.create({ name: "third", stageMode: "staged" });
    fixture.commitEmpty("third");
    fixture.controller.checkout("second");

    fixture.controller.move({
      parent: "main",
      scope: "with-descendants",
    });

    expect(fixture.repository.isAncestor("main", "second")).toBe(true);
    expect(fixture.repository.isAncestor("first", "second")).toBe(false);
    expect(fixture.repository.isAncestor("second", "third")).toBe(true);
  });

  test("squash leaves one branch commit and restacks its child", () => {
    fixture.controller.create({ name: "first", stageMode: "staged" });
    fixture.commitEmpty("first part one");
    fixture.commitEmpty("first part two");
    fixture.controller.create({ name: "second", stageMode: "staged" });
    fixture.commitEmpty("second");
    fixture.controller.checkout("first");

    fixture.controller.squash("first squashed");

    expect(fixture.git(["rev-list", "--count", "main..first"])).toBe("1");
    expect(fixture.repository.isAncestor("first", "second")).toBe(true);
  });
});

function createConflictingStack(fixture: GitFixture): void {
  fixture.write("shared.txt", "base\n");
  fixture.git(["add", "shared.txt"]);
  fixture.git(["commit", "--quiet", "--message", "shared base"]);
  fixture.write("shared.txt", "first\n");
  fixture.controller.create({
    name: "first",
    message: "first",
    stageMode: "all",
  });
  fixture.write("shared.txt", "second\n");
  fixture.controller.create({
    name: "second",
    message: "second",
    stageMode: "all",
  });
  fixture.controller.checkout("first");
  fixture.write("shared.txt", "first updated\n");
  fixture.git(["add", "shared.txt"]);
  fixture.git(["commit", "--amend", "--quiet", "--no-edit"]);
}
