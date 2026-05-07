import { describe, expect, it } from "vitest";

import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";

const users = defineTable("public", "users", {
  id: columnType<number, "int4">({
    nullable: false,
    hasDefault: false,
    isGenerated: false,
  }),
  email: columnType<string, "text">({
    nullable: false,
    hasDefault: false,
    isGenerated: false,
  }),
  age: columnType<number, "int4">({
    nullable: true,
    hasDefault: false,
    isGenerated: false,
  }),
});

describe("Column comparators", () => {
  it("eq with a literal builds BinaryOp(=) with a Parameter rhs", () => {
    expect(users.id.eq(42).node).toEqual({
      kind: "BinaryOp",
      operator: "=",
      left: { kind: "ColumnRef", tableAlias: "users", column: "id" },
      right: { kind: "Parameter", value: 42 },
    });
  });

  it("eq with another column references the column directly", () => {
    expect(users.id.eq(users.age).node).toEqual({
      kind: "BinaryOp",
      operator: "=",
      left: { kind: "ColumnRef", tableAlias: "users", column: "id" },
      right: { kind: "ColumnRef", tableAlias: "users", column: "age" },
    });
  });

  it("neq builds BinaryOp(<>)", () => {
    const expr = users.id.neq(0);
    expect(expr.node).toMatchObject({ kind: "BinaryOp", operator: "<>" });
  });

  it.each([
    ["lt", "<"],
    ["lte", "<="],
    ["gt", ">"],
    ["gte", ">="],
  ] as const)("%s builds BinaryOp(%s)", (method, sql) => {
    const expr = users.age[method](21);
    expect(expr.node).toMatchObject({ kind: "BinaryOp", operator: sql });
  });

  it("isNull builds UnaryOp(IS NULL)", () => {
    expect(users.age.isNull().node).toEqual({
      kind: "UnaryOp",
      operator: "IS NULL",
      operand: { kind: "ColumnRef", tableAlias: "users", column: "age" },
    });
  });

  it("isNotNull builds UnaryOp(IS NOT NULL)", () => {
    expect(users.age.isNotNull().node).toMatchObject({
      kind: "UnaryOp",
      operator: "IS NOT NULL",
    });
  });

  it("in builds InList with each value wrapped as a Parameter", () => {
    expect(users.id.in([1, 2, 3]).node).toEqual({
      kind: "InList",
      operand: { kind: "ColumnRef", tableAlias: "users", column: "id" },
      values: [
        { kind: "Parameter", value: 1 },
        { kind: "Parameter", value: 2 },
        { kind: "Parameter", value: 3 },
      ],
    });
  });
});

describe("Expression combinators", () => {
  it("and combines two booleans into BinaryOp(AND)", () => {
    const left = users.id.eq(1);
    const right = users.email.eq("a@b");
    expect(left.and(right).node).toEqual({
      kind: "BinaryOp",
      operator: "AND",
      left: left.node,
      right: right.node,
    });
  });

  it("or combines two booleans into BinaryOp(OR)", () => {
    const expr = users.id.eq(1).or(users.id.eq(2));
    expect(expr.node).toMatchObject({ kind: "BinaryOp", operator: "OR" });
  });

  it("not negates a boolean with UnaryOp(NOT)", () => {
    const expr = users.id.eq(1).not();
    expect(expr.node).toMatchObject({ kind: "UnaryOp", operator: "NOT" });
  });
});
