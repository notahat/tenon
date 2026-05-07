// Two-step builder for an inner join.
//
// `Relation.innerJoin(other)` returns a JoinBuilder; the only method
// it exposes is `.on(predicate)`, which completes the join into a new
// Relation. Splitting it in two means "forgot the ON clause" is a
// compile error rather than emitting a Cartesian product.
//
// Out of scope: outer joins and joining sub-queries, neither of which
// is yet supported (the fluent surface restricts the right side to a
// defined table).

import { innerJoin as innerJoinNode } from "../ast/relation.js";
import type { RelationNode, TableRef } from "../ast/relation.js";
import type { ColumnsShape } from "../schema-runtime/columnType.js";
import type { Expression } from "./Expression.js";
import { Relation } from "./Relation.js";
import type { MergedColumns } from "./types.js";

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
   * Complete the inner join with a boolean predicate. Predicates may
   * freely reference columns from either side, including those whose
   * names overlap. If the merged columns shape has duplicates, the
   * resulting Relation carries a brand that fails at `Database.run`;
   * `.project(...)` clears it.
   */
  on(predicate: Expression<boolean>): Relation<MergedColumns<Left, Right>> {
    return new Relation<MergedColumns<Left, Right>>(
      innerJoinNode(this.leftSource, this.rightTable, predicate.node),
    );
  }
}
