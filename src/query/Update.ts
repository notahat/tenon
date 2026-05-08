// Fluent wrapper around an UPDATE AST tree. Built by
// `WritableScope.update(attrs)` (the predicate-narrowed path) and
// `WritableSingleRow.update(attrs)` (the primary-key shorthand reached
// through `Table.find(id)`). `.returning(...)` adds (or replaces) the
// RETURNING projection.
//
// The two phantom generics — Columns and Returning — flow through
// `Database.run` so the result type matches the projection: `null`
// when no RETURNING clause was added (run resolves to `{ rowCount }`),
// a ColumnsShape when one was (run resolves to RowOf<Returning>[]).
//
// Out of scope: SQL emission (src/sql/serialise.ts → updateToSql);
// the predicate-narrowing chain (src/query/WritableScope.ts) and the
// primary-key shorthand (src/query/SingleRow.ts).

import { updateNode, type UpdateNode } from "../ast/update.js";
import type { ColumnsShape } from "../schema-runtime/columnType.js";
import { toProjectionItem } from "./projection.js";
import type { ProjectableItem, ProjectedShape } from "./types.js";

export class Update<
  Columns extends ColumnsShape,
  Returning extends ColumnsShape | null,
> {
  // Phantoms: never read at runtime. `_columns` carries the source
  // table's shape for type-machinery use; `_returning` is null when no
  // RETURNING is set (so the run() overload picks the rowCount form)
  // or the projected ColumnsShape when one is.
  declare readonly _columns: Columns;
  declare readonly _returning: Returning;

  constructor(readonly node: UpdateNode) {}

  /**
   * Add or replace the RETURNING clause. Items are bare columns
   * (`users.id`) or aliased columns
   * (`users.created_at.as("createdAt")`), exactly as in
   * `Relation.project(...)`. The projected shape flows into the
   * `Returning` generic so `db.run(...)` resolves to typed rows.
   */
  returning<const Items extends readonly ProjectableItem[]>(
    ...items: Items
  ): Update<Columns, ProjectedShape<Items>> {
    const projectionItems = items.map(toProjectionItem);
    return new Update<Columns, ProjectedShape<Items>>(
      updateNode({
        target: this.node.target,
        assignments: this.node.assignments,
        predicates: this.node.predicates,
        returning: projectionItems,
      }),
    );
  }
}
