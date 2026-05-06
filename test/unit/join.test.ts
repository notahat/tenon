import { describe, expect, it } from "vitest";

import { columnRef } from "../../src/ast/expression.js";
import { binaryOp } from "../../src/ast/expression.js";
import { innerJoin, tableRef } from "../../src/ast/relation.js";

describe("innerJoin factory", () => {
  it("builds an InnerJoin node with the given source, right table, and predicate", () => {
    const left = tableRef({ schema: "public", name: "users" });
    const right = tableRef({ schema: "public", name: "posts" });
    const predicate = binaryOp(
      "=",
      columnRef({ tableAlias: "users", column: "id" }),
      columnRef({ tableAlias: "posts", column: "author_id" }),
    );

    const node = innerJoin(left, right, predicate);

    expect(node).toEqual({
      kind: "InnerJoin",
      source: left,
      right,
      on: predicate,
    });
  });

  it("returns a fresh object on each call (no shared mutable state)", () => {
    const left = tableRef({ schema: "public", name: "users" });
    const right = tableRef({ schema: "public", name: "posts" });
    const predicate = binaryOp(
      "=",
      columnRef({ tableAlias: "users", column: "id" }),
      columnRef({ tableAlias: "posts", column: "author_id" }),
    );

    const a = innerJoin(left, right, predicate);
    const b = innerJoin(left, right, predicate);

    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
