// Fluent wrapper around a relation AST tree. Each operator method
// returns a new Relation; nothing mutates. Two phantom generics flow
// through the chain: Columns describes the row shape after the chain
// runs, and FKs is a tuple of foreign keys carried for join inference
// (commit 6+ uses it to fill in the ON predicate when `.on(...)` is
// omitted from `innerJoin`).
//
// Out of scope: SQL serialisation; column accessor merging (handled
// by `defineTable`, which intersects this type with the per-column
// accessor map).

import {
  limit as limitNode,
  offset as offsetNode,
  order as orderNode,
  project as projectNode,
  where as whereNode,
} from "../ast/relation.js";
import type { RelationNode } from "../ast/relation.js";
import type { ColumnsShape } from "../schema-runtime/columnType.js";
import type { Expression } from "./Expression.js";
import { JoinBuilder } from "./JoinBuilder.js";
import type { Ordering } from "./Ordering.js";
import { toProjectionItem } from "./projection.js";
import type {
  ForeignKeyTuple,
  ProjectableItem,
  ProjectedShape,
} from "./types.js";

export class Relation<
  Columns extends ColumnsShape,
  FKs extends ForeignKeyTuple = readonly [],
> {
  // Phantoms: track the column shape and FK list so future projections
  // and joins can narrow them. Never read at runtime on Relation
  // itself; on Table the `_foreignKeys` field is also a real runtime
  // value carrying the FK list emitted by `defineTable`.
  declare readonly _columns: Columns;
  declare readonly _foreignKeys: FKs;

  constructor(readonly node: RelationNode) {}

  /** Filter this relation by a boolean expression. */
  where(predicate: Expression<boolean>): Relation<Columns, FKs> {
    return new Relation<Columns, FKs>(whereNode(this.node, predicate.node));
  }

  /**
   * Sort this relation by one or more `column.asc()` / `column.desc()`
   * orderings. Calling `.order` again on the result replaces the
   * existing terms (outermost wins); use a single call with all terms
   * if you want a multi-column sort.
   */
  order(...orderings: readonly Ordering[]): Relation<Columns, FKs> {
    const terms = orderings.map((ordering) => ordering.node);
    return new Relation<Columns, FKs>(orderNode(this.node, terms));
  }

  /** Cap this relation at `count` rows. */
  limit(count: number): Relation<Columns, FKs> {
    return new Relation<Columns, FKs>(limitNode(this.node, count));
  }

  /** Skip `count` rows before returning results. */
  offset(count: number): Relation<Columns, FKs> {
    return new Relation<Columns, FKs>(offsetNode(this.node, count));
  }

  /**
   * Restrict (and optionally rename) the columns this relation
   * exposes. The resulting Relation's columns shape is inferred from
   * the literal types of the items so callers see a precise row
   * shape after `db.run(...)`. FKs are preserved unchanged because
   * they describe the source tables, not the projected row shape.
   */
  project<const Items extends readonly ProjectableItem[]>(
    ...items: Items
  ): Relation<ProjectedShape<Items>, FKs> {
    const projectionItems = items.map(toProjectionItem);
    return new Relation<ProjectedShape<Items>, FKs>(
      projectNode(this.node, projectionItems),
    );
  }

  /**
   * Inner-join this relation with another defined table. Returns a
   * builder whose only method is `.on(predicate)`; the join is not
   * complete until the predicate is supplied.
   *
   * The right side is restricted to a `defineTable(...)` value (it
   * must carry `_tableName` / `_schema`) so the join's right side is
   * a base table reference, not an arbitrary sub-query. The right
   * side's FK tuple is captured for later inference passes.
   */
  innerJoin<
    RColumns extends ColumnsShape,
    RFKs extends ForeignKeyTuple = readonly [],
  >(
    right: Relation<RColumns, RFKs> & {
      readonly _tableName: string;
      readonly _schema: string;
    },
  ): JoinBuilder<Columns, FKs, RColumns, RFKs> {
    if (right.node.kind !== "TableRef") {
      throw new Error(
        "innerJoin's right side must be a defined table (got a derived relation).",
      );
    }
    return new JoinBuilder<Columns, FKs, RColumns, RFKs>(this.node, right.node);
  }
}
