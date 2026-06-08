# Updates

Predicate-narrowed `UPDATE` with optional `RETURNING`, accessed
Rails-style through `Table.where(...).update(attrs)` or via the
primary-key shorthand `Table.find(id).update(attrs)`.

`UPDATE ... FROM` (multi-table update) is deferred.

## The basic shape

```ts
const result = await db.run(
  users.where(users.id.eq(42)).update({ name: "Pete" }),
);
//    ^? { rowCount: number }
```

`Table.where(predicate)` returns a scope that carries `.update`
alongside `.delete`. Calling `.update(attrs)` folds the
accumulated predicates and the supplied `SET` attrs into an
`UPDATE` statement.

## Chained predicates

Multiple `.where(...)` calls AND together, just like on a regular
`Relation`:

```ts
users
  .where(users.email.eq("pete@notahat.com"))
  .where(users.active.eq(true))
  .update({ name: "Pete" });
```

Only `.where` keeps the scope alive. `.order`, `.limit`,
`.project`, `.innerJoin` widen back to a plain `Relation`, and
`.update` is no longer available.

## What you can put in attrs

The attrs object accepts any non-generated column. Every key is
optional; nullable columns also accept `null`. Generated columns
(GENERATED ALWAYS AS ... STORED) are absent from the type — the
attempt to set one is a compile error. The primary key is
updatable.

```ts
users
  .where(users.id.eq(1))
  .update({
    name: null,           // OK: name is nullable
    email: "pete@new.io", // OK
    // full_name: "x"     // type error: generated column
  });
```

Values are sent as parameters in the order keys appear on the
attrs object — ES2015+ object-key order, so the SQL is
deterministic.

## `.returning(...)` to read back the updated rows

Chain `.returning(...)` after `.update(...)` to pull columns
from the updated rows:

```ts
const updated = await db.run(
  users
    .where(users.email.eq("pete@notahat.com"))
    .update({ name: "Pete N." })
    .returning(users.id, users.name),
);
//    ^? Array<{ id: number; name: string | null }>
```

Same item shape as `Relation.project`, `Insert.returning`, and
`Delete.returning`: bare columns or `column.as("name")` aliased
columns.

## `find(id).update(attrs)` for primary-key updates

When the row you want to update is one you'd normally fetch via
[`Table.find(id)`](relationships.md), update it the same way:

```ts
await db.run(users.find(1).update({ name: "Pete" }));
// Emits: UPDATE "public"."users" SET "name" = $1 WHERE ("users"."id" = $2)
```

`db.run` resolves to `{ rowCount: 0 | 1 }` — 0 when the row
didn't exist, 1 when it did. Chain `.returning(...)` to recover
columns from the updated row.

## Empty attrs and the empty-WHERE guard

Two runtime guards live in the serialiser:

- `update({})` — the type system can't catch it (every key is
  optional), so the serialiser throws before any SQL is sent.
- A hand-built `UpdateNode` with no predicates throws too. The
  public surface always supplies predicates (`.where` or
  `.find`), so this guard only fires for direct AST users.

There is no `Table.updateAll(...)` escape hatch. Every UPDATE
goes through a `where` or `find` narrowing.

## Aliases and `UPDATE ... AS`

`Table.as("alias")` works on the update side too. The alias
flows into the emitted SQL so qualified column references in the
predicates still resolve:

```ts
const u = users.as("u");

await db.run(u.where(u.email.eq("pete@notahat.com")).update({ name: "Pete" }));
// Emits: UPDATE "public"."users" AS "u" SET "name" = $1 WHERE "u"."email" = $2
```

## See also

- [`Update`, `WritableScope`, `WritableSingleRow`](../reference/update.md) —
  the fluent classes and `.returning(...)` signature.
- [`UpdatableAttrs`](../reference/types.md) — the type-level
  shape of the attrs argument.
- [`Table.where`](../reference/table.md#wherepredicate).
