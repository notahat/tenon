import { describe, expect, it } from "vitest";

import {
  binaryOp,
  columnRef,
  inList,
  parameter,
  unaryOp,
} from "../../src/ast/expression.js";

describe("expression AST factories", () => {
  it("builds a ColumnRef qualified by table alias", () => {
    expect(columnRef({ tableAlias: "u", column: "id" })).toEqual({
      kind: "ColumnRef",
      tableAlias: "u",
      column: "id",
    });
  });

  it("builds a Parameter that carries the value (no index assigned)", () => {
    expect(parameter(42)).toEqual({ kind: "Parameter", value: 42 });
    expect(parameter(null)).toEqual({ kind: "Parameter", value: null });
  });

  it("builds a BinaryOp with operator, left, and right", () => {
    const left = columnRef({ tableAlias: "u", column: "id" });
    const right = parameter(1);

    expect(binaryOp("=", left, right)).toEqual({
      kind: "BinaryOp",
      operator: "=",
      left,
      right,
    });
  });

  it("builds a UnaryOp with operator and operand", () => {
    const operand = columnRef({ tableAlias: "u", column: "deletedAt" });

    expect(unaryOp("IS NULL", operand)).toEqual({
      kind: "UnaryOp",
      operator: "IS NULL",
      operand,
    });
  });

  it("builds an InList with operand and value list", () => {
    const operand = columnRef({ tableAlias: "u", column: "id" });
    const values = [parameter(1), parameter(2), parameter(3)];

    expect(inList(operand, values)).toEqual({
      kind: "InList",
      operand,
      values,
    });
  });
});
