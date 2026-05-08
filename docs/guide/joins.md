# Joins

Inner joins, self-joins via aliasing, the compile-time error
that flags ambiguous joined columns, and FK-inferred ON
predicates.

Outer joins (`leftJoin`, `rightJoin`, `fullJoin`) and joining
sub-queries are not yet supported.

## Inner joins

`relation.innerJoin(otherTable)` returns a `JoinBuilder`. When an
unambiguous foreign key connects the two sides, the builder is
**runnable directly** — the serialiser fills in the ON clause
from FK metadata. Calling `.on(predicate)` is still available
when you want to override or when no FK match exists.

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

## FK-inferred ON predicates

When `tenon-generate` reads a single-column foreign key from
`pg_constraint`, the FK is recorded on the generated `Table`'s
runtime and type-level metadata. `innerJoin` then becomes
runnable without `.on(...)`:

```ts
const recent = await db.run(
  posts.innerJoin(users).project(posts.body, users.email),
);
//    ^? Array<{ body: string; email: string }>
//
// emits: SELECT "posts"."body", "users"."email"
//        FROM "public"."posts"
//        INNER JOIN "public"."users"
//        ON ("posts"."author_id" = "users"."id")
```

The ON clause comes from the FK on `posts` (`author_id` →
`users.id`). Direction doesn't matter — `users.innerJoin(posts)`
infers the same predicate. Composite FKs are skipped (they fall
out of the inference path because the type machinery only
matches single-column FKs).

When the FK is ambiguous, missing, or self-referential, the
type system rejects `db.run(...)` with a literal-template error
message. The three cases:

```ts
// Missing FK: no constraint between the two tables.
const orphan = ...;
db.run(orphan.innerJoin(users));
//     ^^^^^^^^^^^^^^^^^^^^^^^^^^
// Error: tenon: cannot infer ON predicate; no foreign key
//   between public.orphans and public.users; call .on(...)
//   explicitly

// Ambiguous FK: more than one constraint connects the sides
// (e.g. accounts.creator_id and accounts.owner_id both →
// users.id).
db.run(accounts.innerJoin(users));
//     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
// Error: tenon: cannot infer ON predicate; ambiguous foreign
//   keys between public.accounts and public.users; call
//   .on(...) explicitly

// Self-join: same physical table on both sides.
db.run(users.innerJoin(users.as("manager")));
//     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
// Error: tenon: cannot infer ON predicate for self-join on
//   public.users; call .on(...) explicitly or alias one side
```

Each error is just a TypeScript error at the `db.run(...)` call
site — call `.on(predicate)` to clear it. There's a defensive
runtime throw for the same cases in case the type system was
bypassed (e.g. via `as`-cast).

The FK inference is keyed on the literal physical schema and
table name, so `Table.as("alias")` doesn't disrupt the brand:
the alias changes the column qualifier but the inference
machinery still sees both sides as `public.users`. That's why
self-join detection works even when both sides are aliased.

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

## See also

- [`Relation.innerJoin`](../reference/relation.md#innerjoinrighttable)
  and [`JoinBuilder`](../reference/join-builder.md) for the
  reference signatures.
- [`MergedColumns`](../reference/types.md#mergedcolumns)
  for the duplicate-column brand and how to clear it.
