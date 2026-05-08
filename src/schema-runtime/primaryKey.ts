// A primary-key record attached to a Table at definition time. Carries
// the physical column names that make up the table's primary key, in
// constraint order. Used by the fluent layer to expose `Table.find(id)`
// when the key is single-column. Out of scope: primary-key emission to
// SQL (Postgres already enforces it); composite-key `find` (omitted in
// v1, see docs/plans).

/**
 * The set of columns that make up a table's primary key. Single-column
 * keys are the common case and the only one `Table.find` accepts;
 * composite keys are recorded faithfully but not surfaced through
 * `find`. Tables without a declared primary key carry an empty tuple.
 */
export interface PrimaryKey {
  /** Physical columns making up the key, in constraint order. */
  readonly columns: readonly string[];
}
