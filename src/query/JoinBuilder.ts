// Two-step builder for an inner join.
//
// `Relation.innerJoin(other)` returns a JoinBuilder; the only method
// it exposes is `.on(predicate)`, which completes the join into a new
// Relation. Splitting it in two means "forgot the ON clause" is a
// compile error rather than emitting a Cartesian product.
//
// Out of scope: outer joins (deferred), joining sub-queries (the
// fluent surface restricts the right side to a defined table for now).

import { innerJoin as innerJoinNode } from "../ast/relation.js";
import type { RelationNode, TableRef } from "../ast/relation.js";
import type { ColumnsShape } from "../schema-runtime/columnType.js";
import { Relation } from "./Relation.js";
import type { MergedColumns, OnPredicate } from "./types.js";

/** Holds the left-hand side and right-hand table while waiting for `.on()`. */
export class JoinBuilder<
  Left extends ColumnsShape,
  Right extends ColumnsShape,
> {
  // Phantoms: never read at runtime; carry the two columns shapes so
  // `.on(...)` can return a `Relation<MergedColumns<Left, Right>>`.
  declare readonly _left: Left;
  declare readonly _right: Right;

  constructor(
    private readonly leftSource: RelationNode,
    private readonly rightTable: TableRef,
  ) {}

  /**
   * Complete the inner join with a boolean predicate. If the two
   * sides have any overlapping column names, the call fails to
   * compile (see `OnPredicate`); disambiguate with `.project(...)`.
   */
  on(
    predicate: OnPredicate<Left, Right>,
  ): Relation<MergedColumns<Left, Right>> {
    return new Relation<MergedColumns<Left, Right>>(
      innerJoinNode(this.leftSource, this.rightTable, predicate.node),
    );
  }
}
