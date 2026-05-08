# `Table<Alias, Columns>`

The result of `defineTable(schema, name, columns)`. A `Table` is a
`Relation<Columns>` with one `Column` accessor merged in per
declared column, plus the methods below.

`Table` is not a class you instantiate from the main entry —
generated schema files import `defineTable` from
`@notahat/tenon/schema-runtime` to build them. The type itself is
exported from the schema-runtime subpath as `Table`. See
[`schema-runtime`](schema-runtime.md).

## Shape

```ts
type Table<Alias, Columns> = Omit<Relation<Columns>, "where"> &
  Readonly<{ _tableName: Alias; _schema: string }> & {
    readonly [Name in keyof Columns & string]: Column<
      Alias,
      Name,
      Columns[Name]
    >;
  } & {
    as<NewAlias extends string>(alias: NewAlias): Table<NewAlias, Columns>;
    insert(attrs: InsertableAttrs<Columns>): Insert<Columns, null>;
    where(predicate: Expression<boolean>): DeletableScope<Alias, Columns>;
    delete(): Delete<Columns, null>;
    deleteAll(): Delete<Columns, null>;
  };
```

The `Alias` parameter is the qualifier used in column references
and (when not equal to the physical name) in `FROM ... AS ...`.
After `defineTable` it equals the table name; after `.as("u")` it
carries the user-supplied alias.

## Methods

### `.as(alias)`

```ts
as<NewAlias extends string>(alias: NewAlias): Table<NewAlias, Columns>;
```

Re-alias this table for use in joins. Returns a `Table` that
shares the same physical schema and name but qualifies its
columns by the new alias. Enables self-joins and disambiguation
in joins with overlapping column names.

### `.insert(attrs)`

```ts
insert(attrs: InsertableAttrs<Columns>): Insert<Columns, null>;
```

Build an `INSERT` against this table. The `attrs` shape is
derived from the columns: required (NOT NULL, no DEFAULT, not
generated), optional (nullable or has DEFAULT), or absent
(generated). See [`InsertableAttrs`](types.md#insertableattrs).

### `.where(predicate)`

```ts
where(predicate: Expression<boolean>): DeletableScope<Alias, Columns>;
```

Narrow this table for read or DELETE. Overrides
`Relation.where` — returns a [`DeletableScope`](delete.md), which
is a `Relation` that also carries `.delete()`. `.order`,
`.limit`, `.project`, `.innerJoin` widen back to `Relation` and
drop `.delete`.

### `.delete()`

```ts
delete(): Delete<Columns, null>;
```

Footgun catch: builds a `DELETE` with no WHERE clause and the
`allowEmptyPredicates` flag **off**. The serialiser refuses to
emit it; the error points at `deleteAll()`. Always go through
`.where(...).delete()` or `.deleteAll()` instead.

### `.deleteAll()`

```ts
deleteAll(): Delete<Columns, null>;
```

Build a `DELETE` that wipes every row in this table. The
`allowEmptyPredicates` flag is on, so the serialiser does not
throw. Reach for this only when you genuinely want to clear the
table.

## See also

- [Schema and introspection guide](../guide/schema-and-introspection.md).
- [`schema-runtime`](schema-runtime.md) for `defineTable`,
  `columnType`, `ColumnsShape`.
- [`Insert`](insert.md), [`Delete`](delete.md).
