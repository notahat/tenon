// Fluent wrapper around a DELETE AST tree. Built by
// `WritableScope.delete()` (the standard path), `Table.delete()` (the
// runtime footgun catch — emits an empty-WHERE node that the
// serialiser rejects), or `Table.deleteAll()` (the explicit "wipe the
// table" form). `.returning(...)` adds (or replaces) the RETURNING
// projection.
//
// The two phantom generics — Columns and Returning — flow through
// `Database.run` so the result type matches the projection: `null`
// when no RETURNING clause was added (run resolves to `{ rowCount }`),
// a ColumnsShape when one was (run resolves to RowOf<Returning>[]).
//
// Out of scope: SQL emission (src/sql/serialise.ts → deleteToSql);
// the where-chain itself (src/query/WritableScope.ts).

import { deleteNode, type DeleteNode } from "../ast/delete.js";
import type { ColumnsShape } from "../schema-runtime/columnType.js";
import { toProjectionItem } from "./projection.js";
import type { ProjectableItem, ProjectedShape } from "./types.js";

export class Delete<
  Columns extends ColumnsShape,
  Returning extends ColumnsShape | null,
> {
  // Phantoms: never read at runtime. `_columns` carries the source
  // table's shape for type-machinery use; `_returning` is null when no
  // RETURNING is set (so the run() overload picks the rowCount form)
  // or the projected ColumnsShape when one is.
  declare readonly _columns: Columns;
  declare readonly _returning: Returning;

  constructor(readonly node: DeleteNode) {}

  /**
   * Add or replace the RETURNING clause. Items are bare columns
   * (`users.id`) or aliased columns
   * (`users.created_at.as("createdAt")`), exactly as in
   * `Relation.project(...)`. The projected shape flows into the
   * `Returning` generic so `db.run(...)` resolves to typed rows.
   */
  returning<const Items extends readonly ProjectableItem[]>(
    ...items: Items
  ): Delete<Columns, ProjectedShape<Items>> {
    const projectionItems = items.map(toProjectionItem);
    return new Delete<Columns, ProjectedShape<Items>>(
      deleteNode({
        target: this.node.target,
        predicates: this.node.predicates,
        allowEmptyPredicates: this.node.allowEmptyPredicates,
        returning: projectionItems,
      }),
    );
  }
}
