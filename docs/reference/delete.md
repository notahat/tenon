# `Delete<Columns, Returning>`, `WritableScope<Alias, Columns>`

A pending `DELETE` statement (`Delete`) and the where-narrowed
scope on a base table that builds one (`WritableScope`).

```ts
import { Delete, WritableScope } from "@notahat/tenon";
```

You don't construct either directly. `WritableScope` is returned
by `Table.where(predicate)`. `Delete` is returned by
`scope.delete()`, `Table.delete()` (footgun catch), and
`Table.deleteAll()`.

## `Delete<Columns, Returning>`

### Phantoms

```ts
declare readonly _columns: Columns;
declare readonly _returning: Returning;
```

Same role as on [`Insert`](insert.md): `_returning` is `null` (no
RETURNING clause; `db.run` resolves to `{ rowCount }`) or a
`ColumnsShape` (`db.run` resolves to typed rows).

### `.returning(...items)`

```ts
returning<const Items extends readonly ProjectableItem[]>(
  ...items: Items
): Delete<Columns, ProjectedShape<Items>>;
```

Add (or replace) the `RETURNING` clause. Items follow the same
rules as `Relation.project` and `Insert.returning`.

## `WritableScope<Alias, Columns>` extends `Relation<Columns>`

A `Relation` plus `.delete()`. Returned by `Table.where(...)`.
Inherits all the read operators from `Relation`, but only
`.where` returns a `WritableScope` again — the others widen back
to plain `Relation` and lose `.delete`.

### `.where(predicate)` (override)

```ts
override where(
  predicate: Expression<boolean>,
): WritableScope<Alias, Columns>;
```

Narrow the scope further. Like `Relation.where`, but returns the
scope so `.delete` stays available across chained predicates.

### `.delete()`

```ts
delete(): Delete<Columns, null>;
```

Build a `DELETE` statement using the predicates accumulated by
this scope. The returned `Delete` carries `allowEmptyPredicates:
false` — calling `.delete()` on a scope with no `.where`
narrowing (today impossible to construct) would still throw at
serialisation.

## The empty-WHERE guard

`Table.delete()` directly (without `.where(...)`) builds a
`Delete` with no predicates and the `allowEmptyPredicates` flag
**off**. The serialiser refuses to emit it:

```
Error: DELETE without a WHERE clause is forbidden.
       Call Table.deleteAll() if you really mean to wipe every row.
```

The throw happens **before** any SQL is sent. The flag lives on
the AST node so every code path that reaches the serialiser is
guarded, not just the fluent surface.

`Table.deleteAll()` is the only path that flips the flag on.

## Example

```ts
const removed = await db.run(
  users
    .where(users.email.eq("pete@notahat.com"))
    .where(users.active.eq(true))
    .delete()
    .returning(users.id, users.email),
);
//    ^? Array<{ id: number; email: string }>
```

## See also

- [Deletes guide](../guide/deletes.md).
- [`Table.where`](table.md#wherepredicate),
  [`Table.delete`](table.md#delete),
  [`Table.deleteAll`](table.md#deleteall).
