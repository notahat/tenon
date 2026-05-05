// Fluent wrapper for an expression-shaped piece of AST. Carries the
// expression's TypeScript result type as a phantom parameter so
// downstream consumers (e.g. `Relation.where`, which requires a
// boolean) can constrain what they accept.
//
// Out of scope: SQL serialisation (src/sql/serialise.ts); column
// references (src/query/Column.ts).

import { binaryOp, unaryOp } from "../ast/expression.js";
import type { ExpressionNode } from "../ast/expression.js";

export class Expression<TsResult> {
  // Phantom: never assigned at runtime, used only by the type system to
  // constrain `Relation.where(...)` and downstream comparators.
  declare readonly _result: TsResult;

  constructor(readonly node: ExpressionNode) {}

  /** Combine two boolean expressions with SQL `AND`. */
  and(
    this: Expression<boolean>,
    other: Expression<boolean>,
  ): Expression<boolean> {
    return new Expression<boolean>(binaryOp("AND", this.node, other.node));
  }

  /** Combine two boolean expressions with SQL `OR`. */
  or(
    this: Expression<boolean>,
    other: Expression<boolean>,
  ): Expression<boolean> {
    return new Expression<boolean>(binaryOp("OR", this.node, other.node));
  }

  /** Negate a boolean expression with SQL `NOT`. */
  not(this: Expression<boolean>): Expression<boolean> {
    return new Expression<boolean>(unaryOp("NOT", this.node));
  }
}
