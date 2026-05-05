// Fluent wrapper around a relation AST tree. Each operator method
// returns a new Relation; nothing mutates. Phantom Columns generic
// flows the relation's column shape forward so downstream operators
// (and, in commit 5, projection result rows) can reason about it.
//
// Out of scope: SQL serialisation; column accessor merging (handled
// by `defineTable`, which intersects this type with the per-column
// accessor map).

import {
  limit as limitNode,
  offset as offsetNode,
  order as orderNode,
  project as projectNode,
  projectionItem,
  where as whereNode,
} from "../ast/relation.js";
import type { ProjectionItem, RelationNode } from "../ast/relation.js";
import type { ColumnsShape } from "../schema-runtime/columnType.js";
import { AliasedColumn } from "./AliasedColumn.js";
import { Column } from "./Column.js";
import type { Expression } from "./Expression.js";
import type { Ordering } from "./Ordering.js";
import type { ProjectableItem, ProjectedShape } from "./types.js";

export class Relation<Columns extends ColumnsShape> {
  // Phantom: tracks the column shape so future projections / joins can
  // narrow it. Never read at runtime.
  declare readonly _columns: Columns;

  constructor(readonly node: RelationNode) {}

  /** Filter this relation by a boolean expression. */
  where(predicate: Expression<boolean>): Relation<Columns> {
    return new Relation<Columns>(whereNode(this.node, predicate.node));
  }

  /**
   * Sort this relation by one or more `column.asc()` / `column.desc()`
   * orderings. Calling `.order` again on the result replaces the
   * existing terms (outermost wins); use a single call with all terms
   * if you want a multi-column sort.
   */
  order(...orderings: readonly Ordering[]): Relation<Columns> {
    const terms = orderings.map((ordering) => ordering.node);
    return new Relation<Columns>(orderNode(this.node, terms));
  }

  /** Cap this relation at `count` rows. */
  limit(count: number): Relation<Columns> {
    return new Relation<Columns>(limitNode(this.node, count));
  }

  /** Skip `count` rows before returning results. */
  offset(count: number): Relation<Columns> {
    return new Relation<Columns>(offsetNode(this.node, count));
  }

  /**
   * Restrict (and optionally rename) the columns this relation
   * exposes. The resulting Relation's columns shape is inferred from
   * the literal types of the items so callers see a precise row
   * shape after `db.run(...)`.
   */
  project<const Items extends readonly ProjectableItem[]>(
    ...items: Items
  ): Relation<ProjectedShape<Items>> {
    const projectionItems = items.map(toProjectionItem);
    return new Relation<ProjectedShape<Items>>(
      projectNode(this.node, projectionItems),
    );
  }
}

/** Build an AST ProjectionItem from a Column or AliasedColumn. */
function toProjectionItem(item: ProjectableItem): ProjectionItem {
  if (item instanceof AliasedColumn) {
    return projectionItem(item.node, item.outputName);
  }
  if (item instanceof Column) {
    return projectionItem(item.node, item.columnName);
  }
  // The type guards above are exhaustive over ProjectableItem; this
  // throw exists so an accidental bypass at the type level still
  // surfaces a clear runtime error rather than silent corruption.
  throw new Error("project() received a value that is not a column.");
}
