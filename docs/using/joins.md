# Joins

This guide covers combining two or more tables. Tenon does inner joins,
and in the common case it works out the `ON` clause for you from the
foreign keys in your schema. Everything from [queries](queries.md),
filtering, ordering, and projecting, applies to a join too.

The examples use a `users` table and a `posts` table, where
`posts.author_id` is a foreign key referencing `users.id`.

## Inferred joins

`innerJoin` takes another table from your schema. When the two tables
are connected by a single foreign key, you don't write the `ON` clause.
Tenon fills it in from the foreign key when it builds the SQL:

```ts
posts.innerJoin(users);
// ... INNER JOIN "users" ON ("posts"."author_id" = "users"."id")
```

The foreign key can point either way: `posts.innerJoin(users)` and
`users.innerJoin(posts)` both infer the same predicate from the one key
between them.

The right side has to be a table from your schema, not another query.
Joining a derived relation isn't supported, and tenon rejects it.

## Projecting from a join

A joined relation exposes the columns of both tables. Our `users` and
`posts` tables both have an `id` column, so selecting everything would
leave two columns fighting over the same name. Tenon won't let that
compile. Use `project` to choose the columns you want, which also gives
you a precise row type:

```ts
const rows = await db.run(
  posts.innerJoin(users).project(users.email, posts.body),
);
//    ^? Array<{ email: string; body: string | null }>
```

Each column keeps its own type through the join, so the nullable
`posts.body` still comes back as `string | null`. Rename with `.as(...)`
exactly as you would on a single table, which is also how you'd give two
same-named columns distinct keys if you did want both.

You can filter and sort across either table in the same chain:

```ts
await db.run(
  posts
    .innerJoin(users)
    .where(users.age.gte(18))
    .order(posts.id.desc())
    .project(users.email, posts.body),
);
```

## Explicit joins with `.on`

When there's no foreign key to infer from, or you want to join on a
different predicate, supply it with `.on`:

```ts
await db.run(
  users
    .innerJoin(teams)
    .on(users.id.eq(teams.owner_id))
    .project(users.email, teams.name),
);
```

`.on` takes the same boolean expressions as `where`, and the predicate
can reference columns from either side. Use it whenever the link between
two tables isn't a single foreign key: when there's no key at all, when
two keys connect the same pair of tables (so inference would be
ambiguous), or for the self-joins below. In each of those cases a join
without `.on` is a compile error that tells you to add one.

## Self-joins

To join a table to itself, give one side a distinct alias with `.as`,
then write the `ON` yourself. A foreign key can't be inferred here,
because both sides are the same physical table.

Suppose `users` has a nullable `manager_id` pointing at another user:

```ts
const manager = users.as("manager");

const rows = await db.run(
  users
    .innerJoin(manager)
    .on(users.manager_id.eq(manager.id))
    .project(users.email, manager.email.as("manager_email")),
);
//    ^? Array<{ email: string; manager_email: string }>
```

`users.as("manager")` is the same table under a new alias, so its
columns qualify as `manager.*` in the SQL. Aliasing one side is also how
you give the two `email` columns distinct names in the result.

## Joining more than two tables

Chain `innerJoin` to bring in further tables. Each join infers its own
`ON`, or takes its own `.on`:

```ts
await db.run(
  posts
    .innerJoin(users)
    .innerJoin(comments)
    .project(users.email, posts.body, comments.body.as("comment")),
);
```

## Where to go next

- [Relationships](relationships.md): `find` and the foreign-key
  accessors that walk these same links without writing the join.
- [Writes](writes.md): inserts, updates, and deletes.
- [The query pipeline](../internals/pipeline.md): how a join's `ON`
  clause is inferred when the query is serialised.
