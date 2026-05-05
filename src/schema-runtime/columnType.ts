// Phantom-typed carrier for a column's TS type, SQL type tag, and
// nullability. Nullability is preserved both in the type and at runtime;
// the TS type and SQL tag exist purely at the type level so that
// downstream operators (Column comparators, project's row inference)
// can reason about them.
//
// Out of scope: SQL serialisation; runtime type parsing (handled by
// node-postgres' built-in parsers).

/**
 * A description of a single column's static and dynamic shape. The
 * TsType and SqlTag generics are phantom; only `nullable` exists at
 * runtime. The interface is read-only so values returned by
 * `columnType` cannot be tampered with.
 */
export interface ColumnType<
  TsType,
  SqlTag extends string,
  Nullable extends boolean,
> {
  /** Phantom: TS type produced when reading this column. */
  readonly _tsType: TsType;
  /** Phantom: Postgres type tag (e.g. "int4", "text", "timestamptz"). */
  readonly _sqlTag: SqlTag;
  /** Whether values from this column may be NULL. */
  readonly nullable: Nullable;
}

/**
 * Build a ColumnType. The TS type and SQL tag are supplied as type
 * arguments; only `nullable` flows through at runtime. Nullability is
 * captured as a literal type so non-nullable columns reject `null` in
 * comparators while nullable ones accept it.
 */
export function columnType<TsType, SqlTag extends string>(args: {
  readonly nullable: false;
}): ColumnType<TsType, SqlTag, false>;
export function columnType<TsType, SqlTag extends string>(args: {
  readonly nullable: true;
}): ColumnType<TsType, SqlTag, true>;
export function columnType<TsType, SqlTag extends string>(args: {
  readonly nullable: boolean;
}): ColumnType<TsType, SqlTag, boolean> {
  return { nullable: args.nullable } as ColumnType<TsType, SqlTag, boolean>;
}

/** Convenience alias: a columns map as accepted by `defineTable`. */
export type ColumnsShape = Readonly<
  Record<string, ColumnType<unknown, string, boolean>>
>;
