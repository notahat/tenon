// Fluent wrapper around an INSERT AST tree. An Insert is built by
// `Table.insert(attrs)`; `.returning(...)` adds (or replaces) the
// RETURNING projection. The two phantom generics — Columns and
// Returning — flow through `Database.run` so the result type matches
// the projection: `null` when no RETURNING clause was added (run
// resolves to `{ rowCount }`), a ColumnsShape when one was (run
// resolves to RowOf<Returning>[]).
//
// Out of scope: SQL emission (src/sql/serialise.ts → insertToSql);
// the where-chain "Rails-style" insert defaults (deferred to v1.8).

import { insertNode, type InsertNode } from "../ast/insert.js";
import type { ColumnsShape } from "../schema-runtime/columnType.js";
import { toProjectionItem } from "./projection.js";
import type { ProjectableItem, ProjectedShape } from "./types.js";

export class Insert<
  Columns extends ColumnsShape,
  Returning extends ColumnsShape | null,
> {
  // Phantoms: never read at runtime. `_kind` distinguishes Insert from
  // Relation in `Database.run` overload resolution; `_columns` carries
  // the source table's shape for type-machinery use; `_returning` is
  // null when no RETURNING is set (so the run() overload picks the
  // rowCount form) or the projected ColumnsShape when one is.
  declare readonly _kind: "insert";
  declare readonly _columns: Columns;
  declare readonly _returning: Returning;

  constructor(readonly node: InsertNode) {}

  /**
   * Add or replace the RETURNING clause. Items are bare columns
   * (`users.id`) or aliased columns (`users.created_at.as("createdAt")`),
   * exactly as in `Relation.project(...)`. The projected shape flows
   * into the `Returning` generic so `db.run(...)` resolves to typed
   * rows.
   */
  returning<const Items extends readonly ProjectableItem[]>(
    ...items: Items
  ): Insert<Columns, ProjectedShape<Items>> {
    const projectionItems = items.map(toProjectionItem);
    return new Insert<Columns, ProjectedShape<Items>>(
      insertNode({
        target: this.node.target,
        columnValues: this.node.columnValues,
        returning: projectionItems,
      }),
    );
  }
}
