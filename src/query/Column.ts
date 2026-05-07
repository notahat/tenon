// Fluent wrapper for a column reference. A Column is the primary
// building block of expressions: every comparator (eq, lt, in, ...)
// hangs off it. Phantom type parameters let `project` and `where`
// later track which table a column belongs to and what its TS type is.
//
// Out of scope: SQL serialisation; relation construction.

import {
  binaryOp,
  columnRef,
  inList,
  parameter,
  unaryOp,
} from "../ast/expression.js";
import type {
  BinaryOperator,
  ColumnRef,
  ExpressionNode,
} from "../ast/expression.js";
import { orderTerm } from "../ast/relation.js";
import type { ColumnType } from "../schema-runtime/columnType.js";
import { AliasedColumn } from "./AliasedColumn.js";
import { Expression } from "./Expression.js";
import { Ordering } from "./Ordering.js";
import type { ComparableTo } from "./types.js";

export class Column<
  TableName extends string,
  Name extends string,
  Type extends ColumnType<unknown, string, boolean, boolean, boolean>,
> {
  // Phantom: never read at runtime; used to thread table/column/type
  // identity through comparators and `project`.
  declare readonly _tableName: TableName;
  declare readonly _columnName: Name;
  declare readonly _type: Type;

  readonly node: ColumnRef;

  constructor(
    readonly tableAlias: string,
    readonly columnName: Name,
  ) {
    this.node = columnRef({ tableAlias, column: columnName });
  }

  /** Equality. Use `.isNull()` for NULL checks; SQL `=` is not one. */
  eq(other: ComparableTo<Type>): Expression<boolean> {
    return this.compare("=", other);
  }

  /** Inequality. Use `.isNotNull()` for non-NULL checks. */
  neq(other: ComparableTo<Type>): Expression<boolean> {
    return this.compare("<>", other);
  }

  /** Less than. */
  lt(other: ComparableTo<Type>): Expression<boolean> {
    return this.compare("<", other);
  }

  /** Less than or equal. */
  lte(other: ComparableTo<Type>): Expression<boolean> {
    return this.compare("<=", other);
  }

  /** Greater than. */
  gt(other: ComparableTo<Type>): Expression<boolean> {
    return this.compare(">", other);
  }

  /** Greater than or equal. */
  gte(other: ComparableTo<Type>): Expression<boolean> {
    return this.compare(">=", other);
  }

  /** True when the column value is SQL NULL. */
  isNull(): Expression<boolean> {
    return new Expression<boolean>(unaryOp("IS NULL", this.node));
  }

  /** True when the column value is not SQL NULL. */
  isNotNull(): Expression<boolean> {
    return new Expression<boolean>(unaryOp("IS NOT NULL", this.node));
  }

  /** Membership test against a list of values, columns, or expressions. */
  in(values: readonly ComparableTo<Type>[]): Expression<boolean> {
    const valueNodes = values.map(toExpressionNode);
    return new Expression<boolean>(inList(this.node, valueNodes));
  }

  /** Build an ascending ordering term referring to this column. */
  asc(): Ordering {
    return new Ordering(orderTerm(this.node, "asc"));
  }

  /** Build a descending ordering term referring to this column. */
  desc(): Ordering {
    return new Ordering(orderTerm(this.node, "desc"));
  }

  /**
   * Rename this column for projection. The new name becomes a key in
   * the projected row's static shape.
   */
  as<NewName extends string>(name: NewName): AliasedColumn<NewName, Type> {
    return new AliasedColumn<NewName, Type>(this.node, name);
  }

  private compare(
    operator: BinaryOperator,
    other: ComparableTo<Type>,
  ): Expression<boolean> {
    return new Expression<boolean>(
      binaryOp(operator, this.node, toExpressionNode(other)),
    );
  }
}

/**
 * Convert a comparator's right-hand side to an ExpressionNode: pass
 * through Column / Expression nodes, wrap raw values in a Parameter.
 */
function toExpressionNode(value: unknown): ExpressionNode {
  if (value instanceof Column) {
    return value.node;
  }
  if (value instanceof Expression) {
    return value.node;
  }
  return parameter(value);
}
