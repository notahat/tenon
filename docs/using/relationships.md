# Relationships

This guide covers two conveniences built on your primary keys and
foreign keys: `find`, which fetches a row by primary key, and the
association accessors, which walk a foreign key to related rows without
writing a join.

These accessors come from `defineSchema`, which the generated schema
file calls for you. Because it sees every table at once, it can wire the
foreign keys between them into accessors. The examples use a `users`
table and a `posts` table, where `posts.author_id` references
`users.id`.

## Finding a row by primary key

`find` takes a primary-key value and resolves to the single matching
row:

```ts
const user = await db.run(users.find(1));
//    ^? { id: number; email: string; age: number | null }
```

A `find` that matches nothing throws `RowNotFoundError`, so a value you
get back is always a real row, never null:

```ts
await db.run(users.find(999)); // throws RowNotFoundError
```

`find` is also the start of a single-row update or delete, covered in
[writes](writes.md):

```ts
await db.run(users.find(1).update({ age: 40 }));
await db.run(users.find(1).delete());
```

A write to a missing id is not exceptional the way a read is. It simply
affects no rows and reports `{ rowCount: 0 }`.

`find` is available on any table with a single-column primary key. The
generator wires the key in when it reads your schema.

## Walking to related rows

From a found row, an accessor follows a foreign key to the rows on the
other side. Each accessor is itself a query you pass to `db.run`.

A **has-many** accessor goes from a row to the rows that reference it.
`users.find(1).posts` is every post whose `author_id` is 1:

```ts
const posts = await db.run(users.find(1).posts);
//    ^? Array<{ id: number; author_id: number; body: string | null }>
```

A **belongs-to** accessor goes the other way, from a row to the single
row it references. `posts.find(10).author` is the one user that post's
`author_id` points at:

```ts
const author = await db.run(posts.find(10).author);
//    ^? { id: number; email: string; age: number | null }
```

A belongs-to accessor resolves to one row and throws `RowNotFoundError`
on a miss, exactly like `find`.

## How accessors are named

The names come from your schema, by a deliberately plain convention with
no pluralisation or singularisation:

- A **has-many** accessor takes the referencing table's name verbatim.
  Posts referencing users gives `users.find(id).posts`.
- A **belongs-to** accessor takes the foreign-key column with a trailing
  `_id` removed. `author_id` gives `.author`. A column that doesn't end
  in `_id` falls back to the referenced table's name.

Because belongs-to names come from the column, two foreign keys to the
same table get two distinct accessors. A `messages` table with
`sender_id` and `recipient_id`, both referencing `users`, gives
`.sender` and `.recipient`:

```ts
const sender = await db.run(messages.find(100).sender);
const recipient = await db.run(messages.find(100).recipient);
```

An accessor name that would collide with a real column on the table is
skipped rather than shadowing the column.

## Nullable foreign keys

When a foreign-key column is nullable, a row can point at nothing. If
`posts.author_id` is null, `posts.find(id).author` matches no parent and
throws `RowNotFoundError`, the same as any other belongs-to miss.

So before walking a nullable foreign key, check the column itself, which
you have on the row already:

```ts
const post = await db.run(posts.find(10));
const author =
  post.author_id === null ? null : await db.run(posts.find(10).author);
```

## Where to go next

- [Joins](joins.md): the explicit form of what these accessors do for
  you, plus joins that don't follow a single foreign key.
- [Writes](writes.md): `find(id).update(...)` and `find(id).delete()` in
  full.
- [The query pipeline](../internals/pipeline.md): how `find` and the
  accessors compile down to the same SQL machinery as everything else.
