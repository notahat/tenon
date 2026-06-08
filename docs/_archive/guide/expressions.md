# Expressions

Column references, comparison operators, and the boolean
combinators that make up the predicates passed to `where(...)`,
`on(...)`, and friends.

## Columns

Every column on a defined table is exposed as a property of the
table value:

```ts
users.id; // Column<"users", "id", ColumnType<number, "int4", ...>>
users.email; // Column<"users", "email", ColumnType<string, "text", ...>>
```

A `Column` carries three pieces of information at the type level:
the table alias it was qualified by, its column name, and its
column type (which itself carries the TS type, the SQL tag, and
the nullable / hasDefault / isGenerated flags).

You don't usually deal with the type directly — it threads
through expressions and projections automatically. What matters
is what hangs off it.

## Comparison operators

All produce an `Expression<boolean>`. The right-hand side may be
a raw value (becomes a parameter), another column of the same
type, or another `Expression<boolean>`:

| Method       | SQL operator |
| ------------ | ------------ |
| `.eq(x)`     | `=`          |
| `.neq(x)`    | `<>`         |
| `.lt(x)`     | `<`          |
| `.lte(x)`    | `<=`         |
| `.gt(x)`     | `>`          |
| `.gte(x)`    | `>=`         |
| `.in([...])` | `IN (...)`   |

Type compatibility is enforced: `users.id.eq("x")` is a compile
error because `id` is an `int4` and `"x"` is a string. So is
`users.id.eq(posts.body)`, because `int4` and `text` aren't the
same SQL type.

```ts
users.where(users.id.eq(42));
users.where(users.email.in(["a@example.com", "b@example.com"]));
users.innerJoin(posts).on(users.id.eq(posts.authorId));
```

## NULL checks

SQL's `=` does not behave like a NULL check (`x = NULL` is always
NULL, never true). tenon makes this impossible to get wrong:
`.eq(null)` is rejected by the type system. Use `.isNull()` or
`.isNotNull()`:

```ts
users.where(users.email.isNotNull());
posts.where(posts.publishedAt.isNull());
```

## Boolean combinators

`Expression<boolean>` carries `.and`, `.or`, and `.not`:

```ts
users.where(
  users.active.eq(true).and(users.email.isNotNull()).or(users.role.eq("admin")),
);
```

Multiple `.where(...)` calls AND together too — which is usually
clearer than a single chained `.and`:

```ts
users.where(users.active.eq(true)).where(users.email.isNotNull());
```

Reach for `.or` and `.not` when the predicate genuinely needs
them; otherwise prefer separate `.where` calls.

## Renaming for projection

`column.as("name")` returns an `AliasedColumn` whose only purpose
is to feed `project(...)`. The alias becomes the key in the
projected row:

```ts
const summaries = await db.run(
  users.project(users.id, users.email.as("address")),
);
//    ^? Array<{ id: number; address: string }>
```

`as` on a column is for projection only; for reusing the same
table under multiple aliases (self-joins, disambiguation), see
[joins](joins.md), which uses `Table.as("u")` instead.

## Ordering helpers

`column.asc()` and `column.desc()` produce `Ordering` values for
`relation.order(...)`:

```ts
users.order(users.active.desc(), users.email.asc());
```

NULLS FIRST / NULLS LAST is not yet supported; the default
Postgres ordering applies (`asc` puts NULLs last; `desc` puts
NULLs first).

## See also

- [`Column`, `AliasedColumn`, `Expression`](../reference/column-and-expressions.md)
  — every comparator and combinator with signatures.
- [`Ordering`](../reference/ordering.md).
- [`ComparableTo`](../reference/types.md#comparableto) for the
  right-hand-side rule on every comparator.
