import { describe, expect, it } from "vitest";

import { parameter } from "../../src/ast/expression.js";
import { insertColumnValue, insertNode } from "../../src/ast/insert.js";
import { projectionItem, tableRef } from "../../src/ast/relation.js";

describe("insertColumnValue factory", () => {
  it("pairs a physical column name with an expression node", () => {
    const node = insertColumnValue("name", parameter("Pete"));

    expect(node).toEqual({
      column: "name",
      value: { kind: "Parameter", value: "Pete" },
    });
  });
});

describe("insertNode factory", () => {
  it("builds an Insert with the supplied target, values, and no RETURNING by default", () => {
    const target = tableRef({ schema: "public", name: "users" });
    const columnValues = [
      insertColumnValue("name", parameter("Pete")),
      insertColumnValue("age", parameter(42)),
    ];

    const node = insertNode({ target, columnValues });

    expect(node).toEqual({
      kind: "Insert",
      target,
      columnValues,
      returning: null,
    });
  });

  it("captures a RETURNING projection when supplied", () => {
    const target = tableRef({ schema: "public", name: "users" });
    const columnValues = [insertColumnValue("name", parameter("Pete"))];
    const returning = [
      projectionItem(
        { kind: "ColumnRef", tableAlias: "users", column: "id" },
        "id",
      ),
    ];

    const node = insertNode({ target, columnValues, returning });

    expect(node.returning).toBe(returning);
  });

  it("treats an explicit returning of null the same as omitting it", () => {
    const target = tableRef({ schema: "public", name: "users" });
    const node = insertNode({ target, columnValues: [], returning: null });

    expect(node.returning).toBeNull();
  });

  it("returns a fresh object on each call (no shared mutable state)", () => {
    const target = tableRef({ schema: "public", name: "users" });
    const a = insertNode({ target, columnValues: [] });
    const b = insertNode({ target, columnValues: [] });

    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
