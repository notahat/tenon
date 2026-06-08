# Writes

This guide covers inserting, updating, and deleting rows. Writes run
through `db.run(...)` just like reads.

By default a write resolves to a count of the rows it touched:

```ts
const result = await db.run(users.insert({ email: "a@example.com" }));
//    ^? { readonly rowCount: number }
```

Chain `.returning(...)` onto any write to get the affected rows back
instead, typed the same way a `project` is:

```ts
const rows = await db.run(
  users.insert({ email: "a@example.com" }).returning(users.id, users.email),
);
//    ^? Array<{ id: number; email: string }>
```

That split holds for all three verbs: no `.returning`, you get
`{ rowCount }`; with it, you get typed rows.

## Inserting

`insert` takes an object of column values:

```ts
await db.run(users.insert({ email: "a@example.com", age: 30 }));
```

You only supply the columns you're setting. Columns with a database
default, like a `serial` primary key or a column with `DEFAULT`, are
optional and fall to their default when omitted. The type of the attrs
object enforces this: required columns must be present, defaulted ones
may be left out, and generated columns can't be set at all. The
[type mapping](type-mapping.md) guide covers which columns land in which
category.

To read values the database assigned, like a generated id, add
`.returning(...)`:

```ts
const rows = await db.run(
  users.insert({ email: "a@example.com" }).returning(users.id),
);
//    ^? Array<{ id: number }>
```

A nullable column accepts `null` as its value, and stores it:

```ts
await db.run(users.insert({ email: "a@example.com", age: null }));
```

## Updating

An update has to say which rows it touches, so you narrow the table with
`.where(...)` first, then call `.update(...)` with the columns to
change:

```ts
await db.run(
  users.where(users.email.eq("a@example.com")).update({ age: 31 }),
);
```

Chained `.where` calls combine with `AND`, the same as in a query, and
only matching rows are updated:

```ts
await db.run(
  users
    .where(users.age.gte(18))
    .where(users.email.eq("c@example.com"))
    .update({ age: 40 }),
);
```

Updating a single row by primary key is common enough to have a
shorthand: `find(id)` narrows to that row, and you update it directly.

```ts
await db.run(users.find(1).update({ age: 40 }));
```

`find` is covered with the other primary-key helpers in
[relationships](relationships.md).

`.returning(...)` works here too, reflecting the new values:

```ts
const updated = await db.run(
  users.where(users.id.eq(1)).update({ age: 40 }).returning(users.age),
);
//    ^? Array<{ age: number | null }>
```

An update with no `.where` narrowing, or with an empty attrs object, is
rejected before any SQL reaches the database. Narrow the rows you mean
to change, and set at least one column.

## Deleting

Deleting mirrors updating. Narrow with `.where(...)`, then `.delete()`:

```ts
await db.run(users.where(users.email.eq("a@example.com")).delete());
```

`.returning(...)` gives you the rows that were removed:

```ts
const removed = await db.run(
  users.where(users.age.isNull()).delete().returning(users.id),
);
//    ^? Array<{ id: number }>
```

Deleting every row is a separate, explicit call:

```ts
await db.run(users.deleteAll());
```

A bare `users.delete()` with no `.where` is rejected before any SQL is
sent, so a forgotten predicate can't wipe the table by accident. When
you really do mean every row, reach for `deleteAll()`.

## Where to go next

- [Relationships](relationships.md): `find` and the foreign-key
  accessors for reading and writing related rows.
- [Type mapping](type-mapping.md): which columns are required, optional,
  or forbidden when you insert.
- [The query pipeline](../internals/pipeline.md): how a statement
  becomes SQL and runs.
