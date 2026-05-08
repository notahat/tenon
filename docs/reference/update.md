# `Update<Columns, Returning>`, `WritableScope.update`, `WritableSingleRow.update`

A pending `UPDATE` statement (`Update`) plus the two scope-side
entry points that build one (`WritableScope.update` and
`WritableSingleRow.update`).

```ts
import { Update, WritableScope, WritableSingleRow } from "@notahat/tenon";
```

You don't construct `Update` directly. It's returned by:

- `Table.where(predicate).update(attrs)` — predicate-narrowed.
- `Table.find(id).update(attrs)` — primary-key shorthand.

There is no `.update` on `Table` itself, and no `updateAll()`
escape hatch.

## `Update<Columns, Returning>`

### Phantoms

```ts
declare readonly _columns: Columns;
declare readonly _returning: Returning;
```

Same role as on [`Insert`](insert.md) and [`Delete`](delete.md).
`_returning` is `null` when no RETURNING clause is set (so
`db.run` resolves to `{ rowCount }`) or a `ColumnsShape` when
one is set (`db.run` resolves to typed rows).

### `.returning(...items)`

```ts
returning<const Items extends readonly ProjectableItem[]>(
  ...items: Items
): Update<Columns, ProjectedShape<Items>>;
```

Add (or replace) the `RETURNING` clause. Items follow the same
rules as `Relation.project`, `Insert.returning`, and
`Delete.returning`.

## `WritableScope.update(attrs)`

```ts
update(attrs: UpdatableAttrs<Columns>): Update<Columns, null>;
```

Build an `UPDATE` from the predicates accumulated by this scope
and the supplied SET attrs. Object-key iteration order is
preserved, so the emitted SQL is deterministic.

## `WritableSingleRow.update(attrs)`

```ts
update(attrs: UpdatableAttrs<Columns>): Update<Columns, null>;
```

Build an `UPDATE` for the primary-key row this `SingleRow` wraps.
Returned only by `Table.find(id)`; association-derived
`SingleRow` values (e.g. `posts.find(1).author`) carry the plain
`SingleRow` type, which has no `.update`.

## `UpdatableAttrs<Columns>`

```ts
type UpdatableAttrs<Columns> = {
  [Name in keyof Columns as Columns[Name]["isGenerated"] extends true
    ? never
    : Name]?: Columns[Name]["nullable"] extends true
    ? Columns[Name]["_tsType"] | null
    : Columns[Name]["_tsType"];
};
```

All non-generated columns are optional; nullable columns also
accept `null`. Generated columns are absent. The primary key is
updatable. `hasDefault` is irrelevant for UPDATE (defaults apply
only on INSERT), so it isn't consulted.

## The empty-attrs / empty-WHERE guards

Two defensive throws live in the serialiser:

```
Error: UPDATE without any SET assignments is forbidden.
       Pass at least one column to update(...).

Error: UPDATE without a WHERE clause is forbidden.
       Narrow the target with .where(...) or .find(id).
```

The first fires for `update({})`. The second can only fire for a
hand-built `UpdateNode` — every fluent path supplies predicates.
Both throw before any SQL is sent.

## Example

```ts
const updated = await db.run(
  users
    .where(users.email.eq("pete@notahat.com"))
    .update({ name: "Pete N.", active: true })
    .returning(users.id, users.name),
);
//    ^? Array<{ id: number; name: string | null }>
```

## See also

- [Updates guide](../guide/updates.md).
- [`Table.where`](table.md#wherepredicate),
  [`Table.find`](table.md#findid).
