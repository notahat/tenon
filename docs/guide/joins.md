# Joins

Inner joins, self-joins via aliasing, and the compile-time error
that flags ambiguous joined columns.

Outer joins (`leftJoin`, `rightJoin`, `fullJoin`) and joining
sub-queries are not yet supported.

## Inner joins

`relation.innerJoin(otherTable)` returns a builder whose only
method is `.on(predicate)`. Splitting the join in two means
"forgot the ON clause" is a compile error rather than a Cartesian
product:

```ts
const recent = await db.run(
  users
    .innerJoin(posts)
    .on(users.id.eq(posts.authorId))
    .where(posts.body.isNotNull())
    .project(users.email, posts.body.as("post")),
);
//    ^? Array<{ email: string; post: string }>
```

Predicates passed to `.where`, `.on`, and so on may freely
reference columns from either side.

The right-hand side of an inner join must be a defined table
(something `defineTable(...)` produced) — joining a derived
relation isn't supported yet.

## Self-joins via `Table.as("alias")`

If you need the same physical table on both sides of a join, give
one side an alias:

```ts
const u = users.as("u");
const m = users.as("m");

const withManagers = await db.run(
  u
    .innerJoin(m)
    .on(u.managerId.eq(m.id))
    .project(u.email.as("user"), m.email.as("manager")),
);
//    ^? Array<{ user: string; manager: string }>
```

`Table.as("alias")` returns a fresh `Table` value whose columns
are qualified by the new alias. Both the column references in the
predicate (`u.managerId`, `m.id`) and the projection are
unambiguous. The same trick works whenever two tables share a
column name and you want to keep both.

## Duplicate-column compile error

When two joined sides have columns that share a name — say `users`
and `posts` both have `id` — the merged columns shape carries a
brand. The brand survives `.where`, `.order`, and `.limit`, but
it's only checked at `db.run(...)`. The error message names the
columns:

```ts
db.run(users.innerJoin(posts).on(users.id.eq(posts.authorId)));
//     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
// Error: Argument of type ... is not assignable ...
//   tenon: joined relation has duplicate columns: id;
//   project(...) before db.run, or as(...) one side before joining
```

There are two ways to fix it. **Project** to a non-overlapping
shape:

```ts
db.run(
  users
    .innerJoin(posts)
    .on(users.id.eq(posts.authorId))
    .project(users.email, posts.body),
);
```

…or **alias** one side before joining so the merged shape has no
overlap to begin with:

```ts
const p = posts.as("p");

db.run(
  users
    .innerJoin(p)
    .on(users.id.eq(p.authorId))
    .project(users.id, users.email, p.id.as("postId"), p.body),
);
```

Project is usually the right move — joins are almost always
followed by a projection that picks the columns you actually
care about.

## What's deferred

- `leftJoin`, `rightJoin`, `fullJoin`. The AST and type plumbing
  are designed to absorb them; they just aren't implemented yet.
- Joining sub-queries / CTEs. Today the right side of an
  `innerJoin` must be a defined table.
- `USING (column)` syntax. `.on(predicate)` is the only join
  syntax; `USING` would need a separate path.

See the [iteration plans](../plans/) for the design intent on
each.
