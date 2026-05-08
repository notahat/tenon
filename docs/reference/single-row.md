# `SingleRow<Columns>`, `DeletableSingleRow<Columns>`, and `SingleRowOrThrow<Columns>`

A pending query that the type system promises will return 0 or 1
rows. Built by `Table.find(id)` (a primary-key lookup) and the
association accessors merged onto its result by `defineSchema`.

```ts
import {
  DeletableSingleRow,
  SingleRow,
  SingleRowOrThrow,
} from "@notahat/tenon";
```

You don't usually construct any of these directly. `Table.find(id)`
produces a `DeletableSingleRow<Columns>` (a `SingleRow` subclass
with a `.delete()` method); belongs-to accessors wired by
`defineSchema` produce plain `SingleRow<Columns>` values; and
`singleRow.orThrow()` produces a `SingleRowOrThrow<Columns>`. All
three classes are exported so test code and helpers can name them.

## Phantoms

```ts
declare readonly _kind: "SingleRow";   // or "SingleRowOrThrow"
declare readonly _columns: Columns;
```

`_kind` discriminates `SingleRow` from a structurally similar
`Relation` (both wrap a `node: RelationNode`); `Database.run`'s
overload set would otherwise also match a plain `Relation`.
`_columns` carries the row shape forward to `db.run`.

## `.orThrow()`

```ts
orThrow(): SingleRowOrThrow<Columns>;
```

Promote a `SingleRow` to a `SingleRowOrThrow`. The wrapped node is
unchanged; only the type and `db.run`'s contract differ:

| Value | `db.run(...)` resolves to |
|---|---|
| `SingleRow<C>` | `RowOf<C> \| null` |
| `SingleRowOrThrow<C>` | `RowOf<C>` (rejects with `RowNotFoundError` when no row is returned) |

## `DeletableSingleRow.delete()`

```ts
delete(): Delete<Columns, null>;
```

Build a [`Delete`](delete.md) targeting the same row as the
underlying primary-key lookup. The wrapped `LIMIT 1` is dropped
(Postgres has no `DELETE ... LIMIT`, and the primary-key predicate
already restricts the statement to ≤1 row). `db.run(delete)`
resolves to `{ rowCount: 0 | 1 }` — 0 when the row didn't exist,
1 when it did. Chain `.returning(...)` to recover columns from the
deleted row.

`.delete()` is intentionally available **only** on the
`DeletableSingleRow` returned by `Table.find(id)`. Belongs-to
association accessors return plain `SingleRow` because their
underlying SQL is an inner join, not a flat `WHERE pk = ?` —
deleting through a join shape is out of scope for v1. Mirrors the
[`Relation`](relation.md) / [`DeletableScope`](scope.md) split.

```ts
const result = await db.run(schema.posts.find(1).delete());
//    ^? { readonly rowCount: number }

// Recover the deleted body column on the way out:
const [deleted] = await db.run(
  schema.posts.find(1).delete().returning(schema.posts.body),
);
//      ^? { body: string } | undefined
```

## `RowNotFoundError`

```ts
import { RowNotFoundError } from "@notahat/tenon";
```

Thrown by `db.run(singleRow.orThrow())` when the underlying SQL
returns zero rows. `Error` subclass with `name === "RowNotFoundError"`.
Tenon's other "not found" paths return `null` instead; this error
exists for callers who want a control-flow exception at the call
site.

## Example

```ts
import { Database } from "@notahat/tenon";
import { schema } from "./schema";

const db = new Database(pool);

// Returns the user row, or null if no user has id 1.
const user = await db.run(schema.users.find(1));
//    ^? { id: number; email: string; ... } | null

// Throws RowNotFoundError if the user doesn't exist.
const required = await db.run(schema.users.find(1).orThrow());
//    ^? { id: number; email: string; ... }
```

## Association accessors

`defineSchema` merges association accessors onto the SingleRow
returned by `find`. See [`defineSchema`](define-schema.md) for the
naming rules and the `db.run` typing of has-many vs belongs-to.
