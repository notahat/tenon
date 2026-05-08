import { describe, expect, it } from "vitest";

import { binaryOp, columnRef, parameter } from "../../src/ast/expression.js";
import { projectionItem, tableRef } from "../../src/ast/relation.js";
import { updateAssignment, updateNode } from "../../src/ast/update.js";

describe("updateAssignment factory", () => {
  it("captures the column name and value expression", () => {
    const value = parameter("Pete");
    const assignment = updateAssignment("name", value);

    expect(assignment).toEqual({ column: "name", value });
  });
});

describe("updateNode factory", () => {
  it("builds an Update with the supplied target, assignments, and predicates", () => {
    const target = tableRef({ schema: "public", name: "users" });
    const assignments = [updateAssignment("name", parameter("Pete"))];
    const predicates = [
      binaryOp(
        "=",
        columnRef({ tableAlias: "users", column: "id" }),
        parameter(1),
      ),
    ];

    const node = updateNode({ target, assignments, predicates });

    expect(node).toEqual({
      kind: "Update",
      target,
      assignments,
      predicates,
      returning: null,
    });
  });

  it("preserves assignment order", () => {
    const target = tableRef({ schema: "public", name: "users" });
    const assignments = [
      updateAssignment("name", parameter("Pete")),
      updateAssignment("active", parameter(false)),
    ];

    const node = updateNode({ target, assignments, predicates: [] });

    expect(node.assignments).toBe(assignments);
  });

  it("captures a RETURNING projection when supplied", () => {
    const target = tableRef({ schema: "public", name: "users" });
    const returning = [
      projectionItem(columnRef({ tableAlias: "users", column: "id" }), "id"),
    ];

    const node = updateNode({
      target,
      assignments: [updateAssignment("name", parameter("x"))],
      predicates: [],
      returning,
    });

    expect(node.returning).toBe(returning);
  });

  it("treats an explicit returning of null the same as omitting it", () => {
    const target = tableRef({ schema: "public", name: "users" });

    const node = updateNode({
      target,
      assignments: [updateAssignment("name", parameter("x"))],
      predicates: [],
      returning: null,
    });

    expect(node.returning).toBeNull();
  });

  it("returns a fresh object on each call", () => {
    const target = tableRef({ schema: "public", name: "users" });
    const assignments = [updateAssignment("name", parameter("x"))];
    const first = updateNode({ target, assignments, predicates: [] });
    const second = updateNode({ target, assignments, predicates: [] });

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});
