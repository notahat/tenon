# `Relation<Columns>`

A composable read-side query over a columns shape.

```ts
import { Relation } from "@notahat/tenon";
```

You don't usually construct a `Relation` directly — `defineTable`
produces one (intersected with column accessors), and the
operators below return new ones.

## Operators

Every operator returns a **new** `Relation`; nothing mutates.

### `.where(predicate)`

```ts
where(predicate: Expression<boolean>): Relation<Columns>;
```

Filter the relation. Multiple `.where` calls AND together.

### `.order(...orderings)`

```ts
order(...orderings: readonly Ordering[]): Relation<Columns>;
```

Sort by one or more `column.asc()` / `column.desc()` ordering
terms. **Replaces** any prior ordering — pass all terms in a
single call for multi-column sorts.

### `.limit(count)` / `.offset(count)`

```ts
limit(count: number): Relation<Columns>;
offset(count: number): Relation<Columns>;
```

Standard SQL paging.

### `.project(...items)`

```ts
project<const Items extends readonly ProjectableItem[]>(
  ...items: Items
): Relation<ProjectedShape<Items>>;
```

Restrict and optionally rename the columns the relation produces.
Items are bare `Column` references (output keyed by column name)
or `column.as("alias")` aliased columns (output keyed by alias).
The result type narrows to the projected shape.

### `.innerJoin(rightTable)`

```ts
innerJoin<RColumns extends ColumnsShape>(
  right: Relation<RColumns> & {
    readonly _tableName: string;
    readonly _schema: string;
  },
): JoinBuilder<Columns, RColumns>;
```

Begin an inner join. The right side must be a `defineTable(...)`
value. Returns a [`JoinBuilder`](join-builder.md) whose only
method is `.on(predicate)` — splitting the join in two means
"forgot the ON clause" is a compile error rather than a Cartesian
product.

Throws at construction if the right side is not a base table.

## Phantom

```ts
declare readonly _columns: Columns;
```

Used by the type system to thread the column shape through
operators. Never read at runtime.

## See also

- [Queries guide](../guide/queries.md).
- [`Table`](table.md) — the `Relation` you get from `defineTable`,
  with column accessors merged in.
- [`MergedColumns`](types.md#mergedcolumns) for the join column
  shape and the duplicate-column brand.
