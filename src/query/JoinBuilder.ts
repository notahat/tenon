// Two-step builder for an inner join.
//
// `Relation.innerJoin(other)` returns a JoinBuilder; the only method
// it exposes is `.on(predicate)`, which completes the join into a new
// Relation. Splitting it in two means "forgot the ON clause" is a
// compile error rather than emitting a Cartesian product. The four
// generics carry the two sides' column shapes and FK tuples so the
// resulting Relation knows its merged columns shape, its merged FK
// list, and (in commit 7+) whether an unambiguous FK is available.
//
// Out of scope: outer joins and joining sub-queries, neither of which
// is yet supported (the fluent surface restricts the right side to a
// defined table).

import { innerJoin as innerJoinNode } from "../ast/relation.js";
import type { RelationNode, TableRef } from "../ast/relation.js";
import type { ColumnsShape } from "../schema-runtime/columnType.js";
import type { Expression } from "./Expression.js";
import { Relation } from "./Relation.js";
import type {
  ForeignKeyTuple,
  MergedColumns,
  MergedForeignKeys,
} from "./types.js";

/** Holds the left-hand side and right-hand table while waiting for `.on()`. */
export class JoinBuilder<
  Left extends ColumnsShape,
  LFKs extends ForeignKeyTuple,
  Right extends ColumnsShape,
  RFKs extends ForeignKeyTuple,
> {
  // Phantoms: never read at runtime; carry the two columns shapes and
  // FK tuples so `.on(...)` can return a fully-typed merged Relation.
  declare readonly _left: Left;
  declare readonly _leftFks: LFKs;
  declare readonly _right: Right;
  declare readonly _rightFks: RFKs;

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
  on(
    predicate: Expression<boolean>,
  ): Relation<MergedColumns<Left, Right>, MergedForeignKeys<LFKs, RFKs>> {
    return new Relation<
      MergedColumns<Left, Right>,
      MergedForeignKeys<LFKs, RFKs>
    >(innerJoinNode(this.leftSource, this.rightTable, predicate.node));
  }
}
