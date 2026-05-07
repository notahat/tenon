// Shared helper: turn a fluent ProjectableItem (a Column or
// AliasedColumn) into the AST ProjectionItem the SQL serialiser
// consumes. Lives in its own module so both `Relation.project` and
// `Insert.returning` can reuse it without depending on each other.
//
// Out of scope: SQL emission (src/sql/serialise.ts); the fluent
// wrappers themselves (src/query/Column.ts, AliasedColumn.ts).

import { projectionItem, type ProjectionItem } from "../ast/relation.js";
import { AliasedColumn } from "./AliasedColumn.js";
import type { ProjectableItem } from "./types.js";

/** Build an AST ProjectionItem from a Column or AliasedColumn. */
export function toProjectionItem(item: ProjectableItem): ProjectionItem {
  if (item instanceof AliasedColumn) {
    return projectionItem(item.node, item.outputName);
  }
  return projectionItem(item.node, item.columnName);
}
