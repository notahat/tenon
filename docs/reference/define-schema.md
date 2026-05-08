# `defineSchema(...)`

Wires association accessors onto each `Table.find` result, so a
SingleRow returned by `find` exposes the table's foreign-key
neighbours as has-many `Relation`s and belongs-to `SingleRow`s.

```ts
import { defineSchema } from "@notahat/tenon/schema-runtime";
```

## Signature

```ts
function defineSchema<const S extends Record<string, TableShape>>(
  tables: S,
): WiredSchema<S>;
```

Pass a record whose keys are the user-chosen names and whose
values are `defineTable(...)` results. The function mutates each
Table's `find` method in place to produce wired SingleRows, and
returns the same record re-typed so the wired `find`'s richer
return type is visible.

Generated schema files emit:

```ts
export const schema = defineSchema({
  users: defineTable("public", "users", { ... }, [...], { columns: ["id"] }),
  posts: defineTable("public", "posts", { ... }, [...], { columns: ["id"] }),
});
export const { users, posts } = schema;
```

so user code keeps importing `users` / `posts` and gets the wired
types automatically.

## Accessor naming

**Has-many**: the referencing table's physical name verbatim.
`comments.post_id -> posts.id` produces `posts.find(1).comments`.

**Belongs-to**: the FK column with a trailing `_id` stripped, or
the referenced table's name verbatim if there's no `_id` suffix.
`posts.author_id -> users.id` produces `posts.find(1).author`;
`things.owner -> owners.id` produces `things.find(1).owners`.

## `db.run` typing

| Accessor | `db.run(accessor)` resolves to |
|---|---|
| Has-many (e.g. `posts.find(1).comments`) | `RowOf<commentsColumns>[]` |
| Belongs-to (e.g. `comments.find(5).post`) | `RowOf<postsColumns> \| null` |
| Belongs-to + `.orThrow()` | `RowOf<postsColumns>` |

## Skip rules

`defineSchema` silently skips an accessor in three cases:

- **Self-reference.** A self-FK (e.g. `users.manager_id ->
  users.id`) doesn't produce a `users.find(1).users` accessor —
  the accessor name would collide with the table's own physical
  name and the FK direction would be ambiguous. Belongs-to
  accessors derived from the FK column (e.g. `manager`) are
  unaffected and still wire up.
- **Column-name shadow.** When an accessor name matches a column
  on the source table, the column wins and the accessor is
  skipped. Add an explicit join in that case.
- **Missing target (belongs-to).** When a foreign key references
  a table that isn't in the schema bag (e.g. when only some
  tables were passed to `defineSchema`), no accessor is added.

## Ambiguous has-many

When two FKs on a child table point at the same parent (e.g.
`messages.sender_id` and `messages.recipient_id` both reference
`users.id`), the has-many accessor name `messages` on `users` is
ambiguous. The accessor is wired with one of the FKs at runtime
but its columns shape carries `AmbiguousHasManyBrand`, and
`db.run` rejects it with a literal-template error pointing to
`.innerJoin(...).on(...)` as the fix.

Belongs-to is never ambiguous because the accessor names derive
from the FK column (`sender`, `recipient`), not the referenced
table.

## Chained walks

In v1, accessors return non-recursive values:
`comments.find(5).post` is a plain `SingleRow<postsColumns>`, so
a follow-up `.author` doesn't compile. Add an explicit join or
chain through a separate `find` for now; the chained-join runtime
is a v1.12 follow-up.

## `WiredSchema<S>` and `WiredTable<T, S>`

The exported types describe the result of `defineSchema`. Most
callers don't need to name them — the destructured exports in a
generated schema have the correct types automatically.

```ts
import type { WiredSchema, WiredTable } from "@notahat/tenon/schema-runtime";
```
