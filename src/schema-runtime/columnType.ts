// Phantom-typed carrier for a column's TS type, SQL type tag, and
// per-column flags (nullability, default, generated). The TS type and
// SQL tag are phantom; the three flags exist both in the type (so
// downstream operators and `InsertableAttrs` can reason about them)
// and at runtime.
//
// Out of scope: SQL serialisation; runtime type parsing (handled by
// node-postgres' built-in parsers).

/**
 * A description of a single column's static and dynamic shape. The
 * TsType and SqlTag generics are phantom; the three boolean flags
 * exist at runtime. The interface is read-only so values returned by
 * `columnType` cannot be tampered with.
 */
export interface ColumnType<
  TsType,
  SqlTag extends string,
  Nullable extends boolean,
  HasDefault extends boolean,
  IsGenerated extends boolean,
> {
  /** Phantom: TS type produced when reading this column. */
  readonly _tsType: TsType;
  /** Phantom: Postgres type tag (e.g. "int4", "text", "timestamptz"). */
  readonly _sqlTag: SqlTag;
  /** Whether values from this column may be NULL. */
  readonly nullable: Nullable;
  /**
   * True if the column has a DEFAULT clause or is an identity column
   * (serial / GENERATED ... AS IDENTITY). Optional in inserts.
   */
  readonly hasDefault: HasDefault;
  /**
   * True if the column is GENERATED ALWAYS AS (expr) STORED. Forbidden
   * in inserts.
   */
  readonly isGenerated: IsGenerated;
}

// One narrow overload per `(nullable, hasDefault, isGenerated)` triple
// so each flag's literal `true`/`false` flows into the result type.
// Using a single generic signature with `Nullable extends boolean`
// fails to preserve literals when `<TsType, SqlTag>` are explicitly
// provided (TS does not infer the trailing bool params in that case).
// Eight overloads is verbose but the call-site narrowing is essential
// for `RowOf` (nullable) and `InsertableAttrs` (hasDefault, isGenerated).
export function columnType<TsType, SqlTag extends string>(args: {
  readonly nullable: false;
  readonly hasDefault: false;
  readonly isGenerated: false;
}): ColumnType<TsType, SqlTag, false, false, false>;
export function columnType<TsType, SqlTag extends string>(args: {
  readonly nullable: false;
  readonly hasDefault: false;
  readonly isGenerated: true;
}): ColumnType<TsType, SqlTag, false, false, true>;
export function columnType<TsType, SqlTag extends string>(args: {
  readonly nullable: false;
  readonly hasDefault: true;
  readonly isGenerated: false;
}): ColumnType<TsType, SqlTag, false, true, false>;
export function columnType<TsType, SqlTag extends string>(args: {
  readonly nullable: false;
  readonly hasDefault: true;
  readonly isGenerated: true;
}): ColumnType<TsType, SqlTag, false, true, true>;
export function columnType<TsType, SqlTag extends string>(args: {
  readonly nullable: true;
  readonly hasDefault: false;
  readonly isGenerated: false;
}): ColumnType<TsType, SqlTag, true, false, false>;
export function columnType<TsType, SqlTag extends string>(args: {
  readonly nullable: true;
  readonly hasDefault: false;
  readonly isGenerated: true;
}): ColumnType<TsType, SqlTag, true, false, true>;
export function columnType<TsType, SqlTag extends string>(args: {
  readonly nullable: true;
  readonly hasDefault: true;
  readonly isGenerated: false;
}): ColumnType<TsType, SqlTag, true, true, false>;
export function columnType<TsType, SqlTag extends string>(args: {
  readonly nullable: true;
  readonly hasDefault: true;
  readonly isGenerated: true;
}): ColumnType<TsType, SqlTag, true, true, true>;
export function columnType<TsType, SqlTag extends string>(args: {
  readonly nullable: boolean;
  readonly hasDefault: boolean;
  readonly isGenerated: boolean;
}): ColumnType<TsType, SqlTag, boolean, boolean, boolean> {
  return {
    nullable: args.nullable,
    hasDefault: args.hasDefault,
    isGenerated: args.isGenerated,
  } as ColumnType<TsType, SqlTag, boolean, boolean, boolean>;
}

/** Convenience alias: a columns map as accepted by `defineTable`. */
export type ColumnsShape = Readonly<
  Record<string, ColumnType<unknown, string, boolean, boolean, boolean>>
>;
