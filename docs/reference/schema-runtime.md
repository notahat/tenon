# `@notahat/tenon/schema-runtime`

The subpath imported by generated schema files. Application code
typically does **not** import from here directly — read your
generated `schema.ts` to see what's used and import the table
values from there instead.

```ts
import {
  columnType,
  defineTable,
  type ColumnType,
  type ColumnsShape,
  type Table,
} from "@notahat/tenon/schema-runtime";
```

## `defineTable(schema, name, columns)`

```ts
function defineTable<TableName extends string, Columns extends ColumnsShape>(
  schema: string,
  name: TableName,
  columns: Columns,
): Table<TableName, Columns>;
```

Build a runtime [`Table`](table.md) from a schema declaration.
The returned value is a `Relation` with one [`Column`](column-and-expressions.md)
accessor merged in per declared column, plus `.as`, `.insert`,
`.where`, `.delete`, `.deleteAll`. Generated schema files call
this once per table.

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

## `Table<Alias, Columns>`

The shape of a defined table. See [`Table`](table.md) — that page
is the canonical reference; the type is re-exported here because
generated schema files reference it (rarely, in helper types).

## See also

- [Schema and introspection guide](../guide/schema-and-introspection.md).
- [`tenon-generate`](tenon-generate.md) — the CLI that produces
  files importing from this subpath.
