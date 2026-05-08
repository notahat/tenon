# `Table<Alias, Columns, FKs, PK, Schema, PhysicalName>`

The result of `defineTable(schema, name, columns, foreignKeys?, primaryKey?)`.
A `Table` is a `Relation<Columns, FKs>` with one `Column`
accessor merged in per declared column, plus the methods below.

Six generics carry the table's identity and metadata:

- `Alias` — the column-reference qualifier (changes via `.as`).
- `Columns` — the columns shape.
- `FKs` — the foreign-key tuple emitted for this table.
- `PK` — the primary-key column tuple. Single-column PKs surface
  `Table.find(id)` (see below); composite or absent PKs omit it.
- `Schema` — the literal schema name.
- `PhysicalName` — the literal physical table name (preserved
  across aliasing).

The literal `Schema` and `PhysicalName` generics let the
type-level join inference detect self-joins and search FK records
by physical name.

`Table` is not a class you instantiate from the main entry —
generated schema files import `defineTable` from
`@notahat/tenon/schema-runtime` to build them. The type itself is
exported from the schema-runtime subpath as `Table`. See
[`schema-runtime`](schema-runtime.md).

## Shape

```ts
type Table<Alias, Columns, FKs, PK, Schema, PhysicalName> =
  Omit<Relation<Columns, FKs>, "where" | "innerJoin"> &
    Readonly<{
      _tableName: Alias;
      _schema: Schema;
      _physicalName: PhysicalName;
      _foreignKeys: FKs;
      _primaryKey: PK;
      _columnNames: readonly (keyof Columns & string)[];
    }> & {
      readonly [Name in keyof Columns & string]: Column<
        Alias, Name, Columns[Name]
      >;
    } & {
      as<NewAlias extends string>(
        alias: NewAlias,
      ): Table<NewAlias, Columns, FKs, PK, Schema, PhysicalName>;
      innerJoin<RColumns, RFKs, RSchema, RPhysicalName>(
        right: ...,
      ): JoinBuilder<
        Columns, FKs, Schema, PhysicalName,
        RColumns, RFKs, RSchema, RPhysicalName
      >;
      insert(attrs: InsertableAttrs<Columns>): Insert<Columns, null>;
      where(predicate: Expression<boolean>): WritableScope<Alias, Columns, FKs>;
      delete(): Delete<Columns, null>;
      deleteAll(): Delete<Columns, null>;
    } & FindMethod<Columns, PK>;
```

The `Alias` parameter is the qualifier used in column references
and (when not equal to the physical name) in `FROM ... AS ...`.
After `defineTable` it equals the table name; after `.as("u")` it
carries the user-supplied alias. `Schema` and `PhysicalName` stay
locked to the values from `defineTable` so self-join detection
sees through aliasing.

## Methods

### `.as(alias)`

```ts
as<NewAlias extends string>(
  alias: NewAlias,
): Table<NewAlias, Columns, FKs, Schema, PhysicalName>;
```

Re-alias this table for use in joins. Returns a `Table` that
shares the same physical schema and name but qualifies its
columns by the new alias. Enables self-joins and disambiguation
in joins with overlapping column names. `Schema`, `PhysicalName`,
and `FKs` are preserved unchanged, so the FK-inference brand
treats `users.as("u")` and `users.as("v")` as the same physical
table.

### `.innerJoin(rightTable)`

```ts
innerJoin<RColumns, RFKs, RSchema, RPhysicalName>(
  right: Relation<RColumns, RFKs> & {
    readonly _tableName: string;
    readonly _schema: RSchema;
    readonly _physicalName: RPhysicalName;
  },
): JoinBuilder<
  Columns, FKs, Schema, PhysicalName,
  RColumns, RFKs, RSchema, RPhysicalName
>;
```

Begin an inner join, capturing the literal physical identities
of both sides so the resulting `JoinBuilder` carries the
inference brand on its merged-columns shape. This is a
table-specific override of [`Relation.innerJoin`](relation.md#innerjoinrighttable);
the loose form on `Relation` keeps `string` defaults for the
identity generics, which disables the brand for chained left
sides.

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
where(predicate: Expression<boolean>): WritableScope<Alias, Columns>;
```

Narrow this table for read, UPDATE, or DELETE. Overrides
`Relation.where` — returns a [`WritableScope`](delete.md), which
is a `Relation` that also carries `.update(...)` and
`.delete()`. `.order`, `.limit`, `.project`, `.innerJoin` widen
back to `Relation` and drop both write methods.

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

### `.find(id)` (single-column PK only)

```ts
find(id: Columns[PkColumn]["_tsType"]): SingleRow<Columns>;
```

Look up a row by its primary key. Available only when `PK` is a
single-column tuple — composite or absent PKs omit `find` from
the type entirely (`Property 'find' does not exist on...`).

The returned `SingleRow` runs to `RowOf<Columns> | null` via
`db.run`, or `RowOf<Columns>` after `.orThrow()`. Once the table
participates in `defineSchema`, the returned SingleRow also
exposes association accessors.

See [`SingleRow`](single-row.md) and [`defineSchema`](define-schema.md).

## See also

- [Schema and introspection guide](../guide/schema-and-introspection.md).
- [Relationships guide](../guide/relationships.md).
- [`schema-runtime`](schema-runtime.md) for `defineTable`,
  `columnType`, `ColumnsShape`, `PrimaryKey`.
- [`SingleRow`](single-row.md), [`defineSchema`](define-schema.md).
- [`Insert`](insert.md), [`Delete`](delete.md).
