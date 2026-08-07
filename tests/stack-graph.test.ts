import { describe, expect, test } from "vitest";

import type { RepositoryMetadata } from "../src/metadata/schemas.js";
import { StackGraph } from "../src/stack/stack-graph.js";

const metadata: RepositoryMetadata = {
  version: 1,
  trunk: "main",
  branches: {
    first: { parent: "main", base: "a" },
    second: { parent: "first", base: "b" },
    third: { parent: "second", base: "c" },
  },
};

describe("StackGraph", () => {
  test("returns ancestors from trunk toward the selected branch", () => {
    expect(new StackGraph(metadata).ancestorsOf("third")).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  test("returns descendants in parent-before-child order", () => {
    expect(new StackGraph(metadata).descendantsOf("first")).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  test("rejects cycles", () => {
    const cyclicMetadata: RepositoryMetadata = {
      ...metadata,
      branches: {
        first: { parent: "second", base: "a" },
        second: { parent: "first", base: "b" },
      },
    };
    expect(() => new StackGraph(cyclicMetadata).validate()).toThrow(
      "cycle detected",
    );
  });

  test("rejects branches disconnected from trunk", () => {
    const disconnectedMetadata: RepositoryMetadata = {
      ...metadata,
      branches: { first: { parent: "missing", base: "a" } },
    };
    expect(() => new StackGraph(disconnectedMetadata).validate()).toThrow(
      "branch missing is not connected to trunk",
    );
  });

  test("supports branches connected to an additional trunk", () => {
    const multipleTrunks: RepositoryMetadata = {
      ...metadata,
      trunks: ["main", "release"],
      branches: {
        first: { parent: "main", base: "a" },
        patch: { parent: "release", base: "b" },
      },
    };
    const graph = new StackGraph(multipleTrunks);
    expect(() => graph.validate()).not.toThrow();
    expect(graph.ancestorsOf("patch")).toEqual(["patch"]);
    expect(graph.isTracked("release")).toBe(true);
  });
});
