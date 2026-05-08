# Deletes

Predicate-narrowed `DELETE` with optional `RETURNING`, accessed
Rails-style through `Table.where(...).delete()`.

`UPDATE` and `DELETE ... USING` are deferred.

## The basic shape

```ts
const result = await db.run(
  users.where(users.email.eq("pete@notahat.com")).delete(),
);
//    ^? { rowCount: number }
```

`Table.where(predicate)` returns a scope that carries `.delete()`
in addition to the usual read operators. Calling `.delete()`
folds the accumulated predicates into a `DELETE` statement.

## Chained predicates

Multiple `.where(...)` calls AND together, just like on a regular
`Relation`:

```ts
users
  .where(users.email.eq("pete@notahat.com"))
  .where(users.active.eq(true))
  .delete();
```

Equivalent to a single
`.where(emailMatches.and(activeMatches))` call.

Only `.where` keeps the scope alive. `.order`, `.limit`,
`.project`, `.innerJoin` widen back to a plain `Relation`, and
`.delete` is no longer available — which mirrors Postgres, where
`DELETE` doesn't accept `ORDER BY` / `LIMIT` / a projection in
this iteration.

## `.returning(...)` to read back the deleted rows

Chain `.returning(...)` after `.delete()` to pull columns from
the deleted rows:

```ts
const removed = await db.run(
  users.where(users.active.eq(false)).delete().returning(users.id, users.email),
);
//    ^? Array<{ id: number; email: string }>
```

Same item shape as `Relation.project` and `Insert.returning`:
bare columns or `column.as("name")` aliased columns.

## The empty-WHERE guard

Calling `.delete()` directly on a `Table` (without any `.where`
narrowing) is a footgun catch — it builds a `DELETE` with no
WHERE clause but with the explicit "is empty WHERE allowed" flag
**off**. The serialiser refuses to emit it:

```ts
await db.run(users.delete());
// Throws: DELETE without a WHERE clause is forbidden.
//         Call Table.deleteAll() if you really mean to wipe every row.
```

The throw happens before any SQL hits the network. The flag is
on the AST node, so every code path that reaches the serialiser
is guarded — not just the fluent surface.

## `Table.deleteAll()` for a deliberate full wipe

When you really do mean to clear the table, reach for
`deleteAll()`:

```ts
await db.run(users.deleteAll());
// Emits: DELETE FROM "public"."users"
```

`deleteAll()` flips the same flag the other way. It's the only
path that produces a no-WHERE `DELETE` without throwing. Reach
for it sparingly — almost every real delete should be narrowed
through `.where(...)`.

## Aliases and `DELETE FROM ... AS`

`Table.as("alias")` works on the delete side too. The alias
flows into the emitted SQL:

```ts
const u = users.as("u");

await db.run(u.where(u.email.eq("pete@notahat.com")).delete());
// Emits: DELETE FROM "public"."users" AS "u" WHERE "u"."email" = $1
```

This is mostly relevant once tenon supports `DELETE ... USING`
(deferred) — for plain DELETE the alias rarely matters in
practice, but it's preserved on emit so the predicates' qualified
column references resolve correctly.

## See also

- [`Delete`, `DeletableScope`](../reference/delete.md) — the
  fluent classes and `.returning(...)` signature.
- [`Table.where`](../reference/table.md#wherepredicate),
  [`Table.delete`](../reference/table.md#delete),
  [`Table.deleteAll`](../reference/table.md#deleteall).
