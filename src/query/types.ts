// Type-level helpers shared by Column, Expression, and (later)
// Relation. Kept in one place so the type machinery is easy to find
// and reason about as the surface grows.
//
// Out of scope: runtime values; these are purely TypeScript type
// definitions and erased at compile time.

import type { ColumnType, ColumnsShape } from "../schema-runtime/columnType.js";
import type { ForeignKey } from "../schema-runtime/foreignKey.js";
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
export type ComparableTo<
  Type extends ColumnType<unknown, string, boolean, boolean, boolean>,
> =
  | Type["_tsType"]
  | Column<
      string,
      string,
      ColumnType<Type["_tsType"], Type["_sqlTag"], boolean, boolean, boolean>
    >
  | Expression<Type["_tsType"]>;

/**
 * What .project(...) accepts: a bare Column (output name = column
 * name) or an AliasedColumn (output name = explicit alias).
 */
export type ProjectableItem =
  | Column<
      string,
      string,
      ColumnType<unknown, string, boolean, boolean, boolean>
    >
  | AliasedColumn<
      string,
      ColumnType<unknown, string, boolean, boolean, boolean>
    >;

/** Static output name an item contributes to a projected row. */
export type ItemOutputName<Item> =
  Item extends AliasedColumn<
    infer Name,
    ColumnType<unknown, string, boolean, boolean, boolean>
  >
    ? Name
    : Item extends Column<
          string,
          infer Name,
          ColumnType<unknown, string, boolean, boolean, boolean>
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
 * Force the editor to display an object type as its resolved shape
 * rather than as a chain of generic aliases. The mapped type is a
 * structural no-op; the `& {}` intersection prevents TypeScript from
 * collapsing back to the alias name when rendering tooltips.
 */
type Prettify<T> = { [Name in keyof T]: T[Name] } & {};

/**
 * The TS row type produced when executing a Relation<Columns>. Each
 * key is a column name; nullable columns widen by `| null`. The
 * readonly modifier is stripped so the row matches the plain
 * objects node-postgres returns (callers may freely reassign).
 */
export type RowOf<Columns extends ColumnsShape> = Prettify<{
  -readonly [Name in keyof Columns]: Columns[Name]["nullable"] extends true
    ? Columns[Name]["_tsType"] | null
    : Columns[Name]["_tsType"];
}>;

/**
 * A type-level list of foreign keys, threaded through Relation as the
 * second generic. The runtime `ForeignKey` interface in
 * `schema-runtime` carries the same shape; tuple inference at the
 * `defineTable(...)` call site preserves the literal column and table
 * names so later operators can reason about them.
 */
export type ForeignKeyTuple = readonly ForeignKey[];

/**
 * Combined FK list when two relations are joined. Order is preserved
 * (left side first, right side second) so the inference path can
 * search them deterministically. Composite FKs are filtered out at
 * emit time, so every entry here is single-column.
 */
export type MergedForeignKeys<
  L extends ForeignKeyTuple,
  R extends ForeignKeyTuple,
> = readonly [...L, ...R];

/**
 * True when `LSchema.LName` and `RSchema.RName` resolve to the same
 * literal physical (schema, name) pair. Uses the
 * `[A, B] extends [B, A]` tuple-equality dance to enforce literal
 * equality in both directions; widened (`string`) parameters fail
 * the bidirectional check because `string` is not assignable to a
 * literal.
 */
export type IsSamePhysicalTable<
  LSchema extends string,
  LName extends string,
  RSchema extends string,
  RName extends string,
> = [LSchema, LName] extends [RSchema, RName]
  ? [RSchema, RName] extends [LSchema, LName]
    ? true
    : false
  : false;

/**
 * Brand intersected onto a JoinBuilder's merged-columns shape when
 * the two sides resolve to the same physical table. The literal
 * template puts the offending qualified name into the error message
 * so users see `tenon: cannot infer ON predicate for self-join on
 * public.users; ...` at the `db.run(...)` call site.
 */
export type SelfJoinBrand<Schema extends string, Name extends string> = {
  readonly __tenonInferenceSelfJoin: `tenon: cannot infer ON predicate for self-join on ${Schema}.${Name}; call .on(...) explicitly or alias one side`;
};

/**
 * Brand intersected onto a JoinBuilder's merged-columns shape when
 * no foreign key connects the two sides — i.e. zero matches in
 * either direction.
 */
export type MissingFkBrand<
  LSchema extends string,
  LName extends string,
  RSchema extends string,
  RName extends string,
> = {
  readonly __tenonInferenceMissing: `tenon: cannot infer ON predicate; no foreign key between ${LSchema}.${LName} and ${RSchema}.${RName}; call .on(...) explicitly`;
};

/**
 * Brand intersected onto a JoinBuilder's merged-columns shape when
 * more than one foreign key connects the two sides — the inference
 * cannot pick one without guessing.
 */
export type AmbiguousFkBrand<
  LSchema extends string,
  LName extends string,
  RSchema extends string,
  RName extends string,
> = {
  readonly __tenonInferenceAmbiguous: `tenon: cannot infer ON predicate; ambiguous foreign keys between ${LSchema}.${LName} and ${RSchema}.${RName}; call .on(...) explicitly`;
};

/**
 * Tuple of single-column FK records in `FKs` whose
 * `referencedSchema` and `referencedTable` match the target. Used
 * twice (once per direction) to count cross-table matches at the
 * type level.
 */
type FkMatches<
  FKs extends ForeignKeyTuple,
  TargetSchema extends string,
  TargetName extends string,
  Accumulator extends readonly unknown[] = readonly [],
> = FKs extends readonly [
  infer Head extends ForeignKey,
  ...infer Tail extends ForeignKeyTuple,
]
  ? Head["referencedSchema"] extends TargetSchema
    ? Head["referencedTable"] extends TargetName
      ? Head["columns"]["length"] extends 1
        ? FkMatches<
            Tail,
            TargetSchema,
            TargetName,
            readonly [...Accumulator, Head]
          >
        : FkMatches<Tail, TargetSchema, TargetName, Accumulator>
      : FkMatches<Tail, TargetSchema, TargetName, Accumulator>
    : FkMatches<Tail, TargetSchema, TargetName, Accumulator>
  : Accumulator;

/**
 * All single-column FK matches between the two sides, in either
 * direction. The length is what the brand check counts: 0 →
 * missing, 1 → ok, > 1 → ambiguous.
 */
type MatchesBetween<
  LFKs extends ForeignKeyTuple,
  LSchema extends string,
  LName extends string,
  RFKs extends ForeignKeyTuple,
  RSchema extends string,
  RName extends string,
> = readonly [
  ...FkMatches<LFKs, RSchema, RName>,
  ...FkMatches<RFKs, LSchema, LName>,
];

/**
 * Compute the merged-columns shape for a JoinBuilder, intersected
 * with whichever inference brand applies. Order of checks:
 *   1. Any of the four identity generics is the wide `string` type
 *      (e.g. the left side was a chained relation, not a Table) →
 *      no brand. Inference is left to runtime.
 *   2. Self-join: same physical (schema, name) on both sides.
 *   3. Missing FK: zero single-column matches in either direction.
 *   4. Ambiguous FK: more than one match.
 *   5. Otherwise: plain merged columns, no brand.
 *
 * Calling `.on(predicate)` on the JoinBuilder returns plain
 * `MergedColumns` (no brand), so an explicit predicate clears any
 * inference error.
 */
export type MergedColumnsWithFkBrand<
  L extends ColumnsShape,
  R extends ColumnsShape,
  LFKs extends ForeignKeyTuple,
  LSchema extends string,
  LName extends string,
  RFKs extends ForeignKeyTuple,
  RSchema extends string,
  RName extends string,
> =
  // `string extends Union` is true iff at least one member of the
  // union is the wide `string` (a literal would not satisfy it).
  // One check covers all four "is widened" cases.
  string extends LSchema | LName | RSchema | RName
    ? MergedColumns<L, R>
    : IsSamePhysicalTable<LSchema, LName, RSchema, RName> extends true
      ? MergedColumns<L, R> & SelfJoinBrand<LSchema, LName>
      : MatchesBetween<
            LFKs,
            LSchema,
            LName,
            RFKs,
            RSchema,
            RName
          >["length"] extends 0
        ? MergedColumns<L, R> & MissingFkBrand<LSchema, LName, RSchema, RName>
        : MatchesBetween<
              LFKs,
              LSchema,
              LName,
              RFKs,
              RSchema,
              RName
            >["length"] extends 1
          ? MergedColumns<L, R>
          : MergedColumns<L, R> &
              AmbiguousFkBrand<LSchema, LName, RSchema, RName>;

/**
 * Constraint applied by `Database.run` to a Relation's columns
 * shape: none of the run-blocking brands may be present. The
 * duplicate-column brand from `MergedColumns` and the three
 * inference brands from `MergedColumnsWithFkBrand` each use a
 * unique field name; the `?: never` per brand makes the constraint
 * fail when that brand is set, surfacing the brand's
 * literal-template error message at the call site.
 */
export interface UnbrandedColumns {
  readonly __tenonDuplicateColumns?: never;
  readonly __tenonInferenceSelfJoin?: never;
  readonly __tenonInferenceMissing?: never;
  readonly __tenonInferenceAmbiguous?: never;
}

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
        readonly __tenonDuplicateColumns: `tenon: joined relation has duplicate columns: ${DuplicateColumnNames<L, R>}; project(...) before db.run, or as(...) one side before joining`;
      };

/**
 * Names of columns the user must supply to `.insert(...)`: NOT NULL,
 * no DEFAULT, not generated. Generated columns are filtered out
 * earlier; nullable / has-default keys are filtered to the optional
 * map below.
 */
type RequiredInsertKeys<Columns extends ColumnsShape> = {
  [Name in keyof Columns]: Columns[Name]["isGenerated"] extends true
    ? never
    : Columns[Name]["nullable"] extends true
      ? never
      : Columns[Name]["hasDefault"] extends true
        ? never
        : Name;
}[keyof Columns];

/**
 * Names of columns the user may omit from `.insert(...)`: nullable or
 * has a DEFAULT, but not generated.
 */
type OptionalInsertKeys<Columns extends ColumnsShape> = {
  [Name in keyof Columns]: Columns[Name]["isGenerated"] extends true
    ? never
    : Columns[Name]["nullable"] extends true
      ? Name
      : Columns[Name]["hasDefault"] extends true
        ? Name
        : never;
}[keyof Columns];

/**
 * The TS shape `.insert(attrs)` accepts. Required keys: NOT NULL, no
 * DEFAULT, not generated. Optional keys: nullable OR has DEFAULT.
 * Generated columns are absent — supplying one is a "no such property"
 * error. Nullable columns also accept `null`; non-nullable optional
 * columns (those with defaults) do not.
 */
export type InsertableAttrs<Columns extends ColumnsShape> = Prettify<
  {
    [Name in RequiredInsertKeys<Columns>]: Columns[Name]["_tsType"];
  } & {
    [Name in OptionalInsertKeys<Columns>]?: Columns[Name]["nullable"] extends true
      ? Columns[Name]["_tsType"] | null
      : Columns[Name]["_tsType"];
  }
>;
