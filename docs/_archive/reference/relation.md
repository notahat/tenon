# `Relation<Columns, FKs>`

A composable read-side query over a columns shape, with the
source tables' foreign-key tuple threaded along for join
inference.

```ts
import { Relation } from "@notahat/tenon";
```

You don't usually construct a `Relation` directly — `defineTable`
produces one (intersected with column accessors), and the
operators below return new ones.

## Operators

Every operator returns a **new** `Relation`; nothing mutates.

Every operator preserves the `FKs` tuple unchanged so chained
joins stay informed about the source tables' constraints.

### `.where(predicate)`

```ts
where(predicate: Expression<boolean>): Relation<Columns, FKs>;
```

Filter the relation. Multiple `.where` calls AND together.

### `.order(...orderings)`

```ts
order(...orderings: readonly Ordering[]): Relation<Columns, FKs>;
```

Sort by one or more `column.asc()` / `column.desc()` ordering
terms. **Replaces** any prior ordering — pass all terms in a
single call for multi-column sorts.

### `.limit(count)` / `.offset(count)`

```ts
limit(count: number): Relation<Columns, FKs>;
offset(count: number): Relation<Columns, FKs>;
```

Standard SQL paging.

### `.project(...items)`

```ts
project<const Items extends readonly ProjectableItem[]>(
  ...items: Items
): Relation<ProjectedShape<Items>, FKs>;
```

Restrict and optionally rename the columns the relation produces.
Items are bare `Column` references (output keyed by column name)
or `column.as("alias")` aliased columns (output keyed by alias).
The result type narrows to the projected shape; FKs are
preserved unchanged because they describe the source tables, not
the projected row.

### `.innerJoin(rightTable)`

```ts
innerJoin<RColumns extends ColumnsShape, RFKs extends ForeignKeyTuple>(
  right: Relation<RColumns, RFKs> & {
    readonly _tableName: string;
    readonly _schema: string;
  },
): JoinBuilder<Columns, FKs, string, string, RColumns, RFKs, string, string>;
```

Begin an inner join. The right side must be a `defineTable(...)`
value. Returns a [`JoinBuilder`](join-builder.md) which extends
`Relation`, so you can pass the result straight to `db.run(...)`
when an unambiguous FK connects the two sides — the serialiser
will fill in the ON predicate. Calling `.on(predicate)` returns a
fresh `Relation` with an explicit predicate.

When the receiver is a `Table` (not a chained `Relation`), the
[Table-level override of `innerJoin`](table.md) captures literal
schema and physical-name generics so the type system can
compute self-join / missing-FK / ambiguous-FK brands. The loose
`Relation`-level form here keeps `string` defaults for those
generics, which disables the brand for chained left sides.

Throws at construction if the right side is not a base table.

## Phantoms

```ts
declare readonly _columns: Columns;
declare readonly _foreignKeys: FKs;
```

Used by the type system to thread the column shape and FK tuple
through operators. Never read at runtime on Relation; on Table,
`_foreignKeys` is also a real runtime value carrying the FK list
emitted by `defineTable`.

## See also

- [Queries guide](../guide/queries.md).
- [`Table`](table.md) — the `Relation` you get from `defineTable`,
  with column accessors merged in.
- [`MergedColumns`](types.md#mergedcolumns) for the join column
  shape and the duplicate-column brand.
