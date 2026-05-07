import { describe, expect, it } from "vitest";

import { deleteNode } from "../../src/ast/delete.js";
import { binaryOp, columnRef, parameter } from "../../src/ast/expression.js";
import { projectionItem, tableRef } from "../../src/ast/relation.js";

describe("deleteNode factory", () => {
  it("builds a Delete with the supplied target, no predicates, and no RETURNING by default", () => {
    const target = tableRef({ schema: "public", name: "users" });

    const node = deleteNode({ target });

    expect(node).toEqual({
      kind: "Delete",
      target,
      predicates: [],
      allowEmptyPredicates: false,
      returning: null,
    });
  });

  it("captures predicates in the supplied order", () => {
    const target = tableRef({ schema: "public", name: "users" });
    const predicates = [
      binaryOp(
        "=",
        columnRef({ tableAlias: "users", column: "id" }),
        parameter(1),
      ),
      binaryOp(
        "=",
        columnRef({ tableAlias: "users", column: "active" }),
        parameter(true),
      ),
    ];

    const node = deleteNode({ target, predicates });

    expect(node.predicates).toBe(predicates);
  });

  it("flips allowEmptyPredicates when supplied", () => {
    const target = tableRef({ schema: "public", name: "users" });

    const node = deleteNode({ target, allowEmptyPredicates: true });

    expect(node.allowEmptyPredicates).toBe(true);
  });

  it("captures a RETURNING projection when supplied", () => {
    const target = tableRef({ schema: "public", name: "users" });
    const returning = [
      projectionItem(columnRef({ tableAlias: "users", column: "id" }), "id"),
    ];

    const node = deleteNode({ target, returning });

    expect(node.returning).toBe(returning);
  });

  it("treats an explicit returning of null the same as omitting it", () => {
    const target = tableRef({ schema: "public", name: "users" });

    const node = deleteNode({ target, returning: null });

    expect(node.returning).toBeNull();
  });

  it("returns a fresh object on each call", () => {
    const target = tableRef({ schema: "public", name: "users" });
    const first = deleteNode({ target });
    const second = deleteNode({ target });

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});
