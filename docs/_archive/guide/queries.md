# Queries

The mental model and the read-side operators on `Relation`.

## Relations are values

In tenon, a query is a value you build up with chained method
calls and then hand to `db.run(...)`. Each operator
(`where`, `order`, `limit`, ...) returns a **new** `Relation`;
nothing mutates. You can hold on to intermediate relations, store
them in variables, and combine them freely:

```ts
const activeUsers = users.where(users.active.eq(true));
const recent = activeUsers.order(users.createdAt.desc()).limit(10);
const reallyRecent = recent.limit(3);
```

`activeUsers` is unchanged by the `recent` and `reallyRecent`
chains. Nothing executes until `db.run(...)`.

## The read operators

A `Relation<Columns>` exposes five read operators. Order doesn't
matter for correctness — the operators commute the way the
underlying SQL would let you reshape them — but reading them in
the order below mirrors how you'd write them.

### `where(predicate)`

Filter the relation by a boolean expression. Multiple `.where`
calls AND together:

```ts
users.where(users.active.eq(true)).where(users.email.isNotNull());
```

That's two AND-ed predicates, equivalent to a single
`.where(activeAndNotNull)` call. See the
[expressions guide](expressions.md) for the full list of
comparators (`eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `isNull`,
`isNotNull`, `in`) and the `and` / `or` / `not` combinators on
`Expression`.

### `order(...orderings)`

Sort by one or more columns, each tagged ascending or descending:

```ts
users.order(users.active.desc(), users.email.asc());
```

`order` **replaces** any prior ordering rather than appending — if
you want a multi-column sort, pass all the terms in a single call.
Pass orderings produced by `column.asc()` / `column.desc()`; bare
columns are rejected by the type system.

### `limit(count)` and `offset(count)`

Standard SQL paging. Both take a plain `number`:

```ts
users.order(users.createdAt.desc()).limit(20).offset(40);
```

### `project(...items)`

Restrict (and optionally rename) the columns the relation
produces. The result type narrows accordingly:

```ts
const summaries = users.project(users.id, users.email.as("address"));

await db.run(summaries);
//    ^? Array<{ id: number; address: string }>
```

`project` accepts both bare `Column` references (output keyed by
the column's own name) and `column.as("name")` aliased columns
(output keyed by the alias). Anything else is a type error.

## Composing relations

Because operators return new relations, you can factor out shared
fragments:

```ts
function activeOlderThan(cutoff: Date) {
  return users.where(users.active.eq(true)).where(users.createdAt.lt(cutoff));
}

const oldActive = await db.run(
  activeOlderThan(new Date("2024-01-01")).order(users.id.asc()),
);
```

The tenon comparison surface is `eq`, `neq`, `lt`, `lte`, `gt`,
`gte`, `isNull`, `isNotNull`, and `in`. Pattern-match operators
(`LIKE`, `ILIKE`, regex) are deferred.

## What runs when

`db.run(relation)` is the only side-effecting call. Building a
relation never touches the database, never allocates a connection,
and never blocks. That makes relations safe to construct in any
context: top-level constants, inside library functions, in tests.

The shape of the returned rows is inferred from the relation's
column shape. See [running queries](running-queries.md) for the
return-type rules and [type mapping](type-mapping.md) for how
Postgres types map to TypeScript.

## See also

- [`Relation`](../reference/relation.md) — every operator
  enumerated, with signatures.
- [`ProjectableItem`](../reference/types.md#projectableitem) and
  [`ProjectedShape`](../reference/types.md#projectedshape)
  — what `project(...)` accepts and how the result type is
  computed.
