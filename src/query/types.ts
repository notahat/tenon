// Type-level helpers shared by Column, Expression, and (later)
// Relation. Kept in one place so the type machinery is easy to find
// and reason about as the surface grows.
//
// Out of scope: runtime values; these are purely TypeScript type
// definitions and erased at compile time.

import type { ColumnType, ColumnsShape } from "../schema-runtime/columnType.js";
import type { ForeignKey } from "../schema-runtime/foreignKey.js";
import type { PrimaryKey } from "../schema-runtime/primaryKey.js";
import type { AliasedColumn } from "./AliasedColumn.js";
import type { Column } from "./Column.js";
import type { Expression } from "./Expression.js";
import type { Relation } from "./Relation.js";
import type { WritableSingleRow, SingleRow } from "./SingleRow.js";

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
 * Force the editor to display an object type as its resolved shape.
 * Without this, TypeScript renders `RowOf<...>` and `InsertableAttrs<...>`
 * tooltips as the alias name (or a long chain of nested aliases) rather
 * than the concrete `{ id: number; ... }` shape users actually want to
 * read. The mapped type is a structural no-op; the `& {}` intersection
 * prevents TypeScript from collapsing back to the alias name when
 * rendering tooltips.
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
 * physical (schema, name) pair. Used only after `AnyIdentityWidened`
 * has filtered out wide-`string` cases, so all four parameters are
 * literals and a one-directional tuple check suffices.
 */
type IsSamePhysicalTable<
  LSchema extends string,
  LName extends string,
  RSchema extends string,
  RName extends string,
> = [LSchema, LName] extends [RSchema, RName] ? true : false;

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
 * True when at least one of the four (schema, name) generics is the
 * wide `string` type rather than a literal — the left side was a
 * chained relation, not a Table, and the brand check has to bow out.
 * `string extends Union` succeeds iff a member of the union is the
 * wide `string`; one check covers all four.
 */
type AnyIdentityWidened<
  LSchema extends string,
  LName extends string,
  RSchema extends string,
  RName extends string,
> = string extends LSchema | LName | RSchema | RName ? true : false;

/**
 * Pick the FK-inference brand (if any) that applies to a JoinBuilder.
 * Order of checks:
 *   1. Identity widened: bail out, no brand.
 *   2. Self-join: same physical (schema, name) on both sides.
 *   3. Zero FK matches in either direction: missing.
 *   4. Exactly one match: no brand.
 *   5. More than one match: ambiguous.
 */
type FkBrand<
  LFKs extends ForeignKeyTuple,
  LSchema extends string,
  LName extends string,
  RFKs extends ForeignKeyTuple,
  RSchema extends string,
  RName extends string,
> =
  AnyIdentityWidened<LSchema, LName, RSchema, RName> extends true
    ? unknown
    : IsSamePhysicalTable<LSchema, LName, RSchema, RName> extends true
      ? SelfJoinBrand<LSchema, LName>
      : MatchesBetween<
            LFKs,
            LSchema,
            LName,
            RFKs,
            RSchema,
            RName
          >["length"] extends 0
        ? MissingFkBrand<LSchema, LName, RSchema, RName>
        : MatchesBetween<
              LFKs,
              LSchema,
              LName,
              RFKs,
              RSchema,
              RName
            >["length"] extends 1
          ? unknown
          : AmbiguousFkBrand<LSchema, LName, RSchema, RName>;

/**
 * Compute the merged-columns shape for a JoinBuilder, intersected
 * with whichever inference brand applies (or `unknown` for none).
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
> = MergedColumns<L, R> &
  FkBrand<LFKs, LSchema, LName, RFKs, RSchema, RName>;

/**
 * Brand intersected onto a has-many accessor's value type when more
 * than one foreign key on the referencing table points at the parent.
 * The literal-template message names the offending pair so the
 * `db.run` failure tells the user exactly which join to write
 * explicitly.
 */
export type AmbiguousHasManyBrand<
  ParentSchema extends string,
  ParentName extends string,
  ChildSchema extends string,
  ChildName extends string,
> = {
  readonly __tenonAmbiguousHasMany: `tenon: cannot infer has-many accessor; ambiguous foreign keys from ${ChildSchema}.${ChildName} to ${ParentSchema}.${ParentName}; call .innerJoin(...).on(...) explicitly`;
};

/**
 * Constraint applied by `Database.run` to a Relation's columns
 * shape: none of the run-blocking brands may be present. The
 * duplicate-column brand from `MergedColumns`, the three inference
 * brands from `MergedColumnsWithFkBrand`, and the ambiguous-has-many
 * brand from FK accessors each use a unique field name; the `?: never`
 * per brand makes the constraint fail when that brand is set,
 * surfacing the brand's literal-template error message at the call
 * site.
 */
export interface UnbrandedColumns {
  readonly __tenonDuplicateColumns?: never;
  readonly __tenonInferenceSelfJoin?: never;
  readonly __tenonInferenceMissing?: never;
  readonly __tenonInferenceAmbiguous?: never;
  readonly __tenonAmbiguousHasMany?: never;
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

/**
 * The TS shape `.update(attrs)` accepts. All non-generated columns are
 * optional; nullable columns also accept `null`. Generated columns are
 * absent — supplying one is a "no such property" error. `hasDefault`
 * is irrelevant for UPDATE (defaults apply only on INSERT) so it is
 * not consulted. Primary-key columns are updatable; ruling them out
 * would be opinionated and precludes legitimate renumbering.
 */
export type UpdatableAttrs<Columns extends ColumnsShape> = Prettify<{
  [Name in keyof Columns as Columns[Name]["isGenerated"] extends true
    ? never
    : Name]?: Columns[Name]["nullable"] extends true
    ? Columns[Name]["_tsType"] | null
    : Columns[Name]["_tsType"];
}>;

/**
 * The structural shape `defineSchema` reads off each Table value when
 * computing the type-level association map. The schema-runtime `Table`
 * type is wider than this — it carries column accessors, relation
 * methods, and so on — but only these phantom fields drive accessor
 * inference, so isolating them keeps the association-map machinery
 * decoupled from the rest of `Table`.
 *
 * `_columnNames` is the only field with a real runtime value; the
 * others are phantoms. defineSchema reads it to detect accessor /
 * column-name collisions.
 */
export interface TableShape {
  readonly _columns: ColumnsShape;
  readonly _columnNames: readonly string[];
  readonly _foreignKeys: ForeignKeyTuple;
  readonly _primaryKey: PrimaryKey;
  readonly _schema: string;
  readonly _physicalName: string;
}

/**
 * Map from accessor name to value type for has-many associations on
 * the parent table `T`, given the full schema bag `S`. Iterates every
 * other table in `S`, counts the single-column FKs whose referenced
 * (schema, name) matches `T`'s identity, and adds an accessor named
 * after the child's physical name. Three skip conditions:
 *   1. Self-reference: `T` itself is not added (would collide with the
 *      parent's own physical name accessor and the FK target is
 *      ambiguous).
 *   2. No matching FKs: the child has no FK pointing at `T`.
 *   3. Column shadow: the accessor name collides with a column name
 *      already on `T`. (The runtime mirror also skips with a
 *      generated-file comment; see `defineSchema`.)
 *
 * When more than one FK on a single child points at `T`, the value
 * type is intersected with `AmbiguousHasManyBrand` so the accessor is
 * still constructible but `db.run` rejects it with a guiding message.
 */
export type HasManyAccessors<
  T extends TableShape,
  S extends Record<string, TableShape>,
> = {
  [K in keyof S as HasManyAccessorKey<T, S[K]>]: HasManyAccessorValue<
    T,
    S[K]
  >;
};

/**
 * Accessor-name picker for a single child table. Returns the child's
 * physical name when the association applies, or `never` to skip.
 */
type HasManyAccessorKey<T extends TableShape, U extends TableShape> =
  // Self-reference check: same physical (schema, name) as the parent.
  [U["_schema"], U["_physicalName"]] extends [T["_schema"], T["_physicalName"]]
    ? never
    : FkMatches<
          U["_foreignKeys"],
          T["_schema"],
          T["_physicalName"]
        >["length"] extends 0
      ? never
      : U["_physicalName"] extends keyof T["_columns"]
        ? never
        : U["_physicalName"];

/**
 * Value type for a has-many accessor: a `Relation` over the child's
 * columns. When more than one FK from the child points at the parent,
 * `AmbiguousHasManyBrand` is intersected into the columns shape
 * (rather than the Relation itself) so `UnbrandedColumns` catches it
 * at `db.run` time, the same way duplicate-column and self-join
 * brands surface.
 */
type HasManyAccessorValue<T extends TableShape, U extends TableShape> =
  FkMatches<
    U["_foreignKeys"],
    T["_schema"],
    T["_physicalName"]
  >["length"] extends 1
    ? Relation<U["_columns"], U["_foreignKeys"]>
    : Relation<
        U["_columns"] &
          AmbiguousHasManyBrand<
            T["_schema"],
            T["_physicalName"],
            U["_schema"],
            U["_physicalName"]
          >,
        U["_foreignKeys"]
      >;

/**
 * Find the table in `S` whose physical (schema, name) pair matches
 * the given target. Returns `never` when no match exists; the runtime
 * mirror skips such accessors silently.
 */
type LookupTableByPhysical<
  S extends Record<string, TableShape>,
  TargetSchema extends string,
  TargetName extends string,
> = {
  [K in keyof S]: [S[K]["_schema"], S[K]["_physicalName"]] extends [
    TargetSchema,
    TargetName,
  ]
    ? S[K]
    : never;
}[keyof S];

/**
 * Map from accessor name to value type for belongs-to associations on
 * the child table `T`, given the full schema bag `S`. Iterates `T`'s
 * outgoing FKs, looks up the referenced table in `S` by
 * `${schema}.${physicalName}`, and adds an accessor named via
 * `belongsToAccessorName` (FK column with trailing `_id` stripped, or
 * the referenced table name verbatim). Composite FKs are skipped to
 * mirror the type-level filter in `FkMatches`.
 *
 * The accessor's value is recursive — `WiredSingleRow<Ref, S>` carries
 * Ref's own accessors — so chained walks like
 * `comments.find(5).post.author` compile.
 */
export type BelongsToAccessors<
  T extends TableShape,
  S extends Record<string, TableShape>,
> = {
  [Index in keyof T["_foreignKeys"] as BelongsToAccessorKey<
    T["_foreignKeys"][Index & number],
    T["_columns"],
    S
  >]: BelongsToAccessorValue<T["_foreignKeys"][Index & number], S>;
};

/**
 * Accessor-name picker for a single belongs-to FK. Returns the
 * derived name when the FK is single-column, the name doesn't
 * collide with a column on `T`, AND the FK's referenced table is
 * present in the schema bag `S`. Otherwise `never`, which removes
 * the entry from the accessor map.
 */
type BelongsToAccessorKey<
  FK,
  TColumns extends ColumnsShape,
  S extends Record<string, TableShape>,
> = FK extends ForeignKey
  ? FK["columns"]["length"] extends 1
    ? StripIdSuffix<
        FK["columns"][0] & string,
        FK["referencedTable"]
      > extends keyof TColumns
      ? never
      : LookupTableByPhysical<
            S,
            FK["referencedSchema"],
            FK["referencedTable"]
          > extends never
        ? never
        : StripIdSuffix<FK["columns"][0] & string, FK["referencedTable"]>
    : never
  : never;

/**
 * Strip a trailing `_id` from `Col`. If `Col` doesn't end in `_id`,
 * fall back to the referenced table's name verbatim. Mirrors the
 * runtime `belongsToAccessorName` rule.
 */
type StripIdSuffix<
  Col extends string,
  Fallback extends string,
> = Col extends `${infer Stem}_id` ? Stem : Fallback;

/**
 * Value type for a belongs-to accessor: a `SingleRow` over the
 * referenced table's columns. v1 returns plain `SingleRow` (not
 * `WiredSingleRow`) so chained walks like `find().post.author`
 * deliberately don't compile — they would need a chained-join
 * runtime that the v1 SingleRow doesn't carry. See the v1.11 plan's
 * "Open questions" section for the followup.
 */
type BelongsToAccessorValue<FK, S extends Record<string, TableShape>> =
  FK extends ForeignKey
    ? LookupTableByPhysical<
        S,
        FK["referencedSchema"],
        FK["referencedTable"]
      > extends infer Ref
      ? Ref extends TableShape
        ? SingleRow<Ref["_columns"]>
        : never
      : never
    : never;

/** All FK-derived accessors (has-many + belongs-to) for a table. */
export type AccessorsFor<
  T extends TableShape,
  S extends Record<string, TableShape>,
> = HasManyAccessors<T, S> & BelongsToAccessors<T, S>;

/**
 * The result of `Table.find(id)` once `defineSchema` has wired the
 * association map. A `WritableSingleRow<C>` plus the accessor record
 * for the source table — Deletable because `Table.find` always
 * produces the deletable variant; the accessor-derived SingleRows
 * (belongs-to chains) stay plain because their underlying join shape
 * isn't a simple WHERE.
 */
export type WiredSingleRow<
  T extends TableShape,
  S extends Record<string, TableShape>,
> = WritableSingleRow<T["_columns"]> & AccessorsFor<T, S>;
