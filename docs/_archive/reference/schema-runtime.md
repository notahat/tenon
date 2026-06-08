# `@notahat/tenon/schema-runtime`

The subpath imported by generated schema files. Application code
typically does **not** import from here directly — read your
generated `schema.ts` to see what's used and import the table
values from there instead.

```ts
import {
  columnType,
  defineSchema,
  defineTable,
  type ColumnType,
  type ColumnsShape,
  type ForeignKey,
  type PrimaryKey,
  type Table,
  type WiredSchema,
  type WiredTable,
} from "@notahat/tenon/schema-runtime";
```

## `defineTable(schema, name, columns, foreignKeys?, primaryKey?)`

```ts
function defineTable<
  TableName extends string,
  Schema extends string,
  Columns extends ColumnsShape,
  const FKs extends readonly ForeignKey[] = readonly [],
  const PK extends PrimaryKey = { readonly columns: readonly [] },
>(
  schema: Schema,
  name: TableName,
  columns: Columns,
  foreignKeys?: FKs,
  primaryKey?: PK,
): Table<TableName, Columns, FKs, PK, Schema, TableName>;
```

Build a runtime [`Table`](table.md) from a schema declaration.
The returned value is a `Relation` with one [`Column`](column-and-expressions.md)
accessor merged in per declared column, plus `.as`, `.insert`,
`.where`, `.delete`, `.deleteAll`, `.innerJoin`, and (when the
primary key is single-column) `.find`. Generated schema files
call this once per table inside a `defineSchema(...)` wrapper.

The `Schema` and `TableName` generics flow through to the
returned `Table`'s phantom `_schema` and `_physicalName` fields.
The fluent layer reads those literal types when computing the
self-join / missing-FK / ambiguous-FK brands at `db.run(...)`.

The optional `foreignKeys` argument records the table's outgoing
single-column foreign keys for join inference. Composite FKs are
filtered out at emit time; pass them as `as const` (which
`tenon-generate` does) so the literal column and table names
flow into the type. See the [joins guide](../guide/joins.md#fk-inferred-on-predicates)
for the call-site behaviour.

The optional `primaryKey` argument records the columns that make
up the table's primary key. Single-column keys surface
`Table.find(id)`; composite or absent keys omit it from the
type. The argument is also passed positionally — pass `[]` for
`foreignKeys` when only `primaryKey` is supplied. See the
[relationships guide](../guide/relationships.md) for what `find`
unlocks.

## `defineSchema(tables)`

```ts
function defineSchema<const S extends Record<string, TableShape>>(
  tables: S,
): WiredSchema<S>;
```

Wire FK association accessors onto each Table's `find` result.
Pass a record of Tables (the keys are the user-chosen names);
the returned bag is the same record, mutated in place and
re-typed so each table's `find` reports the wider SingleRow with
has-many and belongs-to accessors merged in.

Generated schema files emit
`export const { users, posts, ... } = defineSchema({ ... });` so
user code imports the wired tables directly. Hand-written
schemas use the same pattern. See [`defineSchema`](define-schema.md)
for the accessor naming rules and skip cases.

## `columnType<TsType, SqlTag>(flags)`

```ts
function columnType<TsType, SqlTag extends string>(args: {
  readonly nullable: boolean;
  readonly hasDefault: boolean;
  readonly isGenerated: boolean;
}): ColumnType<TsType, SqlTag, ..., ..., ...>;
```

Carry the static and dynamic shape of one column: TypeScript
type, Postgres type tag, and three flags. The `TsType` and
`SqlTag` parameters are phantom; the flags exist both in the
type (so `RowOf` and `InsertableAttrs` can reason about them) and
at runtime.

The function is overloaded per `(nullable, hasDefault,
isGenerated)` triple so each flag's literal `true`/`false` flows
into the result type. The eight overloads matter — a single
`Nullable extends boolean` signature would not preserve literals
when callers pass the `<TsType, SqlTag>` parameters explicitly.

## `ColumnType<TsType, SqlTag, Nullable, HasDefault, IsGenerated>`

```ts
interface ColumnType<TsType, SqlTag, Nullable, HasDefault, IsGenerated> {
  readonly _tsType: TsType; // phantom
  readonly _sqlTag: SqlTag; // phantom
  readonly nullable: Nullable; // runtime + type
  readonly hasDefault: HasDefault; // runtime + type
  readonly isGenerated: IsGenerated; // runtime + type
}
```

The interface is read-only.

## `ColumnsShape`

```ts
type ColumnsShape = Readonly<
  Record<string, ColumnType<unknown, string, boolean, boolean, boolean>>
>;
```

A columns map as accepted by `defineTable`. Used as the constraint
on every `Columns` generic in tenon.

## `Table<Alias, Columns, FKs, PK, Schema, PhysicalName>`

The shape of a defined table. See [`Table`](table.md) — that page
is the canonical reference; the type is re-exported here because
generated schema files reference it (rarely, in helper types).

## `ForeignKey`

```ts
interface ForeignKey {
  readonly name: string;
  readonly columns: readonly string[];
  readonly referencedSchema: string;
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
}
```

One foreign-key constraint as recorded by `tenon-generate`.
Composite FKs would have `columns.length > 1`; in v1 the emitter
drops them before they reach `defineTable`. Schema and table
names refer to physical names — aliasing on the consuming Table
doesn't rewrite them.

## `PrimaryKey`

```ts
interface PrimaryKey {
  readonly columns: readonly string[];
}
```

The columns making up a table's primary key, in constraint
order. Single-column keys surface `Table.find(id)`; composite
keys are recorded faithfully but don't get a `find` method.
Tables without a declared primary key carry an empty
`columns: []` tuple.

## `WiredSchema<S>` and `WiredTable<T, S>`

The result types of `defineSchema(...)`. `WiredSchema<S>` maps
each entry's `Table` to a `WiredTable<T, S>`, which in turn
strips the original `find` and re-adds it returning a SingleRow
with FK association accessors merged in. Most users don't name
these types directly — the destructured exports in a generated
schema have the right types automatically. Re-exported from this
subpath for use in helper types.

See [`defineSchema`](define-schema.md) for the runtime mutation
this describes and the accessor naming / skip rules.

## See also

- [Schema and introspection guide](../guide/schema-and-introspection.md).
- [Relationships guide](../guide/relationships.md).
- [`tenon-generate`](tenon-generate.md) — the CLI that produces
  files importing from this subpath.
- [`defineSchema` reference](define-schema.md) for the wiring
  function in detail.
