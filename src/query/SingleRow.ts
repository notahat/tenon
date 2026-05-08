// Fluent wrapper around a RelationNode that the type system promises
// will produce 0 or 1 rows. Built by `Table.find(id)` (a primary-key
// lookup) and threaded through `db.run` with a different return shape:
// `RowOf<Columns> | null` rather than `RowOf<Columns>[]`. Calling
// `.orThrow()` produces a `SingleRowOrThrow<Columns>` whose `db.run`
// returns `RowOf<Columns>` directly and rejects with a not-found error.
//
// SingleRow is structurally a thin tag over a RelationNode — same SQL
// emission path as Relation. The "0 or 1" promise is enforced at the
// runtime by a `LIMIT 1` baked into the node by `Table.find`, and at
// the type level by being a separate class from Relation.
//
// Out of scope: SQL serialisation (src/sql/serialise.ts); association
// accessors merged onto SingleRow values by defineSchema (added in
// steps 3 and 4 of the v1.11 plan).

import type { RelationNode } from "../ast/relation.js";
import type { ColumnsShape } from "../schema-runtime/columnType.js";

/**
 * A query that returns 0 or 1 rows when run. `db.run(singleRow)`
 * resolves to `RowOf<Columns> | null`. Use `.orThrow()` for the
 * non-null variant.
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

  /**
   * Promote this SingleRow to one that throws when no row is found.
   * The returned value is a different class so `Database.run` can
   * dispatch by `instanceof`; the wrapped node is unchanged.
   */
  orThrow(): SingleRowOrThrow<Columns> {
    return new SingleRowOrThrow<Columns>(this.node);
  }
}

/**
 * A query that returns exactly one row when run. `db.run(singleRow)`
 * resolves to `RowOf<Columns>` and rejects with a `RowNotFoundError`
 * when the underlying SQL returns no rows.
 */
export class SingleRowOrThrow<Columns extends ColumnsShape> {
  declare readonly _kind: "SingleRowOrThrow";
  declare readonly _columns: Columns;

  constructor(readonly node: RelationNode) {}
}

/**
 * Thrown by `db.run(singleRow.orThrow())` when the underlying query
 * returns zero rows. Tenon's other "not found" paths (`SingleRow` on
 * its own) return `null` instead; this error exists for callers who
 * want a control-flow exception at the call site.
 */
export class RowNotFoundError extends Error {
  constructor(message = "tenon: no row found for SingleRow.orThrow()") {
    super(message);
    this.name = "RowNotFoundError";
  }
}
