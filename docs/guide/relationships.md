# Relationships

`tenon` reads foreign-key metadata at introspection time and uses
it to wire up two convenience APIs: FK-inferred join predicates
(covered in [Joins](joins.md)), and **association accessors** on
the result of a primary-key lookup. This page is about the second.

## The shape of the API

Generated schema files end with a `defineSchema(...)` call that
wires every Table together:

```ts
export const schema = defineSchema({
  users: defineTable("public", "users", { ... }, [...], { columns: ["id"] }),
  posts: defineTable("public", "posts", { ... }, [...], { columns: ["id"] }),
  comments: defineTable("public", "comments", { ... }, [...], { columns: ["id"] }),
});
export const { users, posts, comments } = schema;
```

After the destructure, the per-table exports carry both
`Table.find(id)` (a primary-key lookup) and association accessors
on its result. With FKs `posts.author_id -> users.id` and
`comments.post_id -> posts.id`, you can write:

```ts
import { Database } from "@notahat/tenon";
import { posts, comments, users } from "./schema";

const db = new Database(pool);

// Belongs-to: walk from a single comment to its parent post.
const parent = await db.run(comments.find(5).post);
//    ^? { id: number; author_id: number; ... } | null

// Has-many: list every comment on a single post.
const list = await db.run(posts.find(1).comments);
//    ^? { id: number; post_id: number; ... }[]

// orThrow: skip the null and reject when not found.
const required = await db.run(comments.find(5).orThrow());
//    ^? { id: number; ... }

// Delete by primary key.
const result = await db.run(posts.find(1).delete());
//    ^? { readonly rowCount: number }
// `result.rowCount` is 0 if no row matched, 1 if the row was deleted.
```

## How `find` works

`Table.find(id)` is available only on tables with a single-column
primary key. The argument is typed by the PK column, so
`posts.find("hello")` fails to compile when `posts.id` is `int4`.

`find` is lazy: it builds a `SingleRow<Columns>` AST and doesn't
hit the database until you pass it to `db.run(...)`. The returned
SingleRow has two lookups baked in:

- The primary-key WHERE: `users.find(1)` -> `WHERE users.id = $1
  LIMIT 1`.
- Association accessors merged on by `defineSchema`.

Composite or missing primary keys omit `find` from the Table type
(standard "property does not exist" error). Use `.where(...)`
explicitly in that case.

## How accessors are named

**Has-many** (FK *into* this table). Use the referencing table's
physical name verbatim:

| FK | Accessor |
|---|---|
| `comments.post_id -> posts.id` | `posts.find(1).comments` |
| `messages.author_id -> users.id` | `users.find(1).messages` |

**Belongs-to** (FK *out of* this table). Strip a trailing `_id`
from the FK column, or fall back to the referenced table's name:

| FK | Accessor |
|---|---|
| `posts.author_id -> users.id` | `posts.find(1).author` |
| `comments.post_id -> posts.id` | `comments.find(5).post` |
| `things.owner -> owners.id` | `things.find(1).owners` |

The names are derived literally — no pluralisation library, no
special-case singularisation beyond the `_id` rule. The trade-off
is predictability over English-correctness.

## Deleting by primary key

`find(id).delete()` builds a `Delete` statement on the same
primary-key predicate. The wrapped `LIMIT 1` is dropped because
Postgres has no `DELETE ... LIMIT` and the predicate already
restricts the statement to ≤1 row. `db.run(...)` resolves to
`{ rowCount: 0 | 1 }` — 0 when the row didn't exist, 1 when it did.

```ts
await db.run(posts.find(42).delete());
// DELETE FROM "posts" WHERE ("posts"."id" = $1)

// Recover the row's columns on the way out:
const [deleted] = await db.run(
  posts.find(42).delete().returning(posts.body),
);
//      ^? { body: string } | undefined
```

`.delete()` is available **only** on the `find(id)` result —
belongs-to accessors (e.g. `comments.find(5).post.delete()`) won't
compile. Their underlying SQL is an inner join, not a flat
`WHERE pk = ?`, and deleting through that shape is out of scope
for v1. To delete the parent, follow the FK manually:

```ts
const post = await db.run(comments.find(5).post.orThrow());
await db.run(posts.find(post.id).delete());
```

## What you can't do (yet)

- **Chained walks** like `comments.find(5).post.author`. The
  belongs-to accessor returns a plain `SingleRow`, not a
  `WiredSingleRow`, so a follow-up `.author` doesn't compile.
  Implementing chains needs a chained-join runtime where each
  step extends an existing query rather than starting a new one;
  it's a v1.12 follow-up.
- **`findBy({ ... })`** for non-PK lookups. Use
  `users.where(users.email.eq("...")).limit(1)` and read the
  array.
- **`update()`** on `find(id)` (or anywhere else). Update isn't
  modelled in tenon yet; `delete()` is the only mutation you can
  reach from a `find` anchor today.
- **Composite primary keys.** `find` is omitted; use the
  appropriate `where(...)` chain.
- **Accessors on plain `Relation` chains** (e.g.
  `posts.where(...).comments`). Anchor association walks at
  `find`; or write the join explicitly.

## When the accessor doesn't show up

`defineSchema` silently skips an accessor in three cases:

- **Self-reference.** A self-FK on `users` (e.g. `manager_id ->
  users.id`) doesn't produce a `users.find(1).users` accessor.
  The belongs-to accessor (`manager`) is fine — only the
  has-many side collides with the table's own physical name.
- **Column-name shadow.** If the parent table has a column with
  the same name as the would-be accessor, the column wins. For
  example, `posts` having a `comments: text` column suppresses
  the `posts.find(1).comments` has-many accessor. Write the
  join explicitly, or use a different column name.
- **Missing target.** If a foreign key references a table that
  isn't in the schema bag passed to `defineSchema`, the
  belongs-to accessor isn't added. Usually a sign you've
  introspected a partial schema.

## When the accessor surfaces a brand error

Has-many is ambiguous when two FKs on the same child table point
at the same parent (e.g. `messages.sender_id` and
`messages.recipient_id` both reference `users.id`). The accessor
on `users.find(1).messages` is wired but its columns shape is
branded; `db.run` rejects it with a literal-template error
pointing at `.innerJoin(...).on(...)` as the fix.

Belongs-to is never ambiguous because the accessor names derive
from the FK column name, not the referenced table.

## See also

- [Joins](joins.md) — the lower-level FK-inferred join used when
  you need a join, not an anchored walk.
- [`SingleRow`](../reference/single-row.md) — the value type
  `find` produces.
- [`defineSchema`](../reference/define-schema.md) — full reference
  for the wiring function and its skip rules.
