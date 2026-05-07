// Helper for writing reusable, composable relation transforms ("scopes"
// in the Rails sense). A scope is just a function from Relation to
// Relation, so composition is ordinary function application — no fluent
// dot-chain machinery is needed. `scope` exists purely so the body can
// be written without repeating the relation's column-shape annotation
// and without closing over a module-level table reference.
//
// Out of scope: dot-chain composition; structural (cross-table) scopes;
// runtime caching or memoisation of scope results.

import type { ColumnsShape } from "../schema-runtime/columnType.js";
import type { Relation } from "./Relation.js";

/**
 * A relation transform: same column shape in, same column shape out.
 * Scopes compose by ordinary function application, e.g.
 * `recent(active(users))` or `pipe(users, active, recent)`.
 */
export type Scope<Columns extends ColumnsShape> = (
  relation: Relation<Columns>,
) => Relation<Columns>;

/**
 * Anchor a scope's types to a specific table so the body can be written
 * without an explicit `Relation<Columns>` annotation. The `table`
 * argument is purely a type anchor — it's discarded at runtime, and
 * the body closes over whatever schema references it needs at the call
 * site. The returned function is just a `Scope<Columns>`, suitable for
 * composition with other scopes or operators.
 */
export function scope<Table extends Relation<ColumnsShape>>(
  table: Table,
  body: (relation: Relation<Table["_columns"]>) => Relation<Table["_columns"]>,
): Scope<Table["_columns"]> {
  return body;
}
