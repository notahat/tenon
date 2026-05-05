// Public entry point for the trel library.
//
// Re-exports the user-facing surface: the executor, the fluent query
// classes, and the public type helpers. The schema-runtime helpers
// (`defineTable`, `columnType`) are exposed under the
// `trel/schema-runtime` subpath because generated schema files are
// the only consumers and we don't want them to muddy the main entry.

export { Database } from "./executor/Database.js";
export { Relation } from "./query/Relation.js";
export { Column } from "./query/Column.js";
export { AliasedColumn } from "./query/AliasedColumn.js";
export { Expression } from "./query/Expression.js";
export { Ordering } from "./query/Ordering.js";
export type {
  ComparableTo,
  ProjectableItem,
  ProjectedShape,
  RowOf,
} from "./query/types.js";
