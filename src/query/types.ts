// Type-level helpers shared by Column, Expression, and (later)
// Relation. Kept in one place so the type machinery is easy to find
// and reason about as the surface grows.
//
// Out of scope: runtime values; these are purely TypeScript type
// definitions and erased at compile time.

import type { ColumnType, ColumnsShape } from "../schema-runtime/columnType.js";
import type { AliasedColumn } from "./AliasedColumn.js";
import type { Column } from "./Column.js";
import type { Expression } from "./Expression.js";

/**
 * Values acceptable on the right-hand side of an ordering or equality
 * comparator against a column of the given Type. Three forms:
 *   - a raw value of the column's TS type (becomes a Parameter);
 *   - another Column whose TS type and SQL tag match (so `int4 = int4`
 *     works but `int4 = text` does not);
 *   - an Expression whose result matches the column's TS type.
 *
 * NULL is not accepted here. Use `.isNull()` / `.isNotNull()` instead;
 * the SQL `=` and `<>` operators do not behave as null-checks.
 */
export type ComparableTo<Type extends ColumnType<unknown, string, boolean>> =
  | Type["_tsType"]
  | Column<
      string,
      string,
      ColumnType<Type["_tsType"], Type["_sqlTag"], boolean>
    >
  | Expression<Type["_tsType"]>;

/**
 * What .project(...) accepts: a bare Column (output name = column
 * name) or an AliasedColumn (output name = explicit alias).
 */
export type ProjectableItem =
  | Column<string, string, ColumnType<unknown, string, boolean>>
  | AliasedColumn<string, ColumnType<unknown, string, boolean>>;

/** Static output name an item contributes to a projected row. */
export type ItemOutputName<Item> =
  Item extends AliasedColumn<infer Name, ColumnType<unknown, string, boolean>>
    ? Name
    : Item extends Column<
          string,
          infer Name,
          ColumnType<unknown, string, boolean>
        >
      ? Name
      : never;

/** ColumnType the item carries through to the projected row. */
export type ItemColumnType<Item> =
  Item extends AliasedColumn<string, infer Type>
    ? Type
    : Item extends Column<string, string, infer Type>
      ? Type
      : never;

/**
 * Build a ColumnsShape from a tuple of projectable items. Each item
 * becomes one entry keyed by its output name and carrying its
 * ColumnType (so projected relations remain composable).
 */
export type ProjectedShape<Items extends readonly ProjectableItem[]> = {
  readonly [Item in Items[number] as ItemOutputName<Item>]: ItemColumnType<Item>;
};

/**
 * The TS row type produced when executing a Relation<Columns>. Each
 * key is a column name; nullable columns widen by `| null`. The
 * readonly modifier is stripped so the row matches the plain
 * objects node-postgres returns (callers may freely reassign).
 */
export type RowOf<Columns extends ColumnsShape> = {
  -readonly [Name in keyof Columns]: Columns[Name]["nullable"] extends true
    ? Columns[Name]["_tsType"] | null
    : Columns[Name]["_tsType"];
};

/** The set of column names shared between two columns shapes. */
export type DuplicateColumnNames<L, R> = Extract<keyof L & keyof R, string>;

/**
 * Combined columns shape for an inner-joined relation: the union of
 * both sides' columns, keyed by name. When the two sides share any
 * column names, an unmatched brand is intersected in. The brand
 * propagates through `.where` / `.order` and is only rejected at
 * `Database.run`; `.project(...)` returns a fresh shape that drops it.
 * The brand's literal-template message names the offending columns so
 * the run-site error tells the user exactly what to project.
 */
export type MergedColumns<L extends ColumnsShape, R extends ColumnsShape> =
  DuplicateColumnNames<L, R> extends never
    ? Readonly<L & R>
    : Readonly<L & R> & {
        readonly __trelDuplicateColumns: `trel: joined relation has duplicate columns: ${DuplicateColumnNames<L, R>}; project(...) before db.run, or as(...) one side before joining`;
      };
