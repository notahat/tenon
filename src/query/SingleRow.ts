// Fluent wrapper around a RelationNode that the type system promises
// will produce a single row. Built by `Table.find(id)` (a primary-key
// lookup) and threaded through `db.run` with a different return shape:
// `RowOf<Columns>` rather than `RowOf<Columns>[]`. If the underlying
// query returns no rows, `db.run` rejects with `RowNotFoundError`;
// there is no nullable variant. Callers who want to tolerate a missing
// row should drop down to `.where(...)` and inspect the resulting
// array.
//
// SingleRow is structurally a thin tag over a RelationNode — same SQL
// emission path as Relation. The "exactly one row" promise is enforced
// at runtime by a `LIMIT 1` baked into the node by `Table.find` and at
// the type level by being a separate class from Relation.
//
// `WritableSingleRow` is the subclass that `Table.find` actually
// returns — same SELECT path, plus `.delete()` and `.update(attrs)`
// methods that build DELETE/UPDATE on the underlying primary-key
// predicate. Association-built SingleRows (belongs-to chains in
// defineSchema) construct plain SingleRow because the underlying join
// shape can't be turned into a flat DELETE/UPDATE. Mirrors the
// Relation / WritableScope split.
//
// Out of scope: SQL serialisation (src/sql/serialise.ts); association
// accessors merged onto SingleRow values by defineSchema.

import { deleteNode } from "../ast/delete.js";
import type { ExpressionNode } from "../ast/expression.js";
import { parameter } from "../ast/expression.js";
import type { RelationNode, TableRef } from "../ast/relation.js";
import { updateAssignment, updateNode } from "../ast/update.js";
import type { ColumnsShape } from "../schema-runtime/columnType.js";
import { Delete } from "./Delete.js";
import type { UpdatableAttrs } from "./types.js";
import { Update } from "./Update.js";

/**
 * A query that returns exactly one row when run. `db.run(singleRow)`
 * resolves to `RowOf<Columns>` and rejects with `RowNotFoundError`
 * when the underlying SQL returns zero rows. Built by
 * `Table.find(id)` and by belongs-to accessors merged on by
 * `defineSchema`.
 */
export class SingleRow<Columns extends ColumnsShape> {
  // Phantoms: never read at runtime. `_kind` discriminates SingleRow
  // from a structurally-similar Relation (both wrap a `node:
  // RelationNode`); without it `Database.run`'s SingleRow overload
  // would also match a plain Relation. `_columns` carries the row
  // shape forward.
  declare readonly _kind: "SingleRow";
  declare readonly _columns: Columns;

  constructor(readonly node: RelationNode) {}
}

/**
 * A SingleRow that also knows how to build a DELETE or UPDATE for
 * itself. The concrete class returned by `Table.find(id)`.
 * `Database.run` matches via the SingleRow overload (subclass
 * relation), so the SELECT path is unchanged; the extra surface is
 * `.delete()` and `.update(attrs)`, both targeting the same row by
 * its primary-key predicate.
 *
 * The `LIMIT 1` baked into the wrapped RelationNode is dropped at
 * DELETE/UPDATE time — Postgres doesn't support `DELETE ... LIMIT` or
 * `UPDATE ... LIMIT`, and the primary-key predicate already restricts
 * the statement to at most one row.
 */
export class WritableSingleRow<
  Columns extends ColumnsShape,
> extends SingleRow<Columns> {
  constructor(
    node: RelationNode,
    private readonly target: TableRef,
    private readonly predicates: readonly ExpressionNode[],
  ) {
    super(node);
  }

  /**
   * Build a DELETE for this row. `db.run` resolves to `{ rowCount: 0
   * | 1 }` — 0 when the row didn't exist, 1 when it did. Chain
   * `.returning(...)` on the result to recover columns from the
   * deleted row.
   */
  delete(): Delete<Columns, null> {
    return new Delete<Columns, null>(
      deleteNode({
        target: this.target,
        predicates: this.predicates,
        allowEmptyPredicates: false,
      }),
    );
  }

  /**
   * Build an UPDATE for this row. `db.run` resolves to `{ rowCount: 0
   * | 1 }` — 0 when the row didn't exist, 1 when it did. Chain
   * `.returning(...)` on the result to recover columns from the
   * updated row. Passing `{}` typechecks but throws at run time.
   */
  update(attrs: UpdatableAttrs<Columns>): Update<Columns, null> {
    const assignments = Object.entries(attrs as Record<string, unknown>).map(
      ([columnName, value]) => updateAssignment(columnName, parameter(value)),
    );
    return new Update<Columns, null>(
      updateNode({
        target: this.target,
        assignments,
        predicates: this.predicates,
      }),
    );
  }
}

/**
 * Thrown by `db.run(singleRow)` when the underlying query returns
 * zero rows. SingleRow is the throwing-by-default surface — there is
 * no nullable variant. Callers who want to tolerate a missing row
 * should query via `.where(...)` and inspect the array.
 */
export class RowNotFoundError extends Error {
  constructor(message = "tenon: no row found for SingleRow query") {
    super(message);
    this.name = "RowNotFoundError";
  }
}
