// A foreign-key record attached to a Table at definition time. Used by
// the fluent layer to infer the ON predicate when an `innerJoin` is
// called without `.on(...)` and an unambiguous FK connects the two
// sides. Out of scope: enforcing referential integrity (Postgres
// already does); composite-FK inference (recorded but skipped in v1).

/**
 * A foreign-key relationship between this table and another. Schema
 * names are absolute, table and column names are physical (not
 * aliased). One record per FK constraint, including composite FKs
 * (where `columns` and `referencedColumns` have matching length > 1).
 */
export interface ForeignKey {
  /** The constraint name, exactly as recorded by Postgres. */
  readonly name: string;
  /** Referencing columns on this table, in constraint order. */
  readonly columns: readonly string[];
  /** Schema of the referenced table. */
  readonly referencedSchema: string;
  /** Physical name of the referenced table. */
  readonly referencedTable: string;
  /**
   * Referenced columns on the target table, paired positionally with
   * `columns`. Always the same length as `columns`.
   */
  readonly referencedColumns: readonly string[];
}
