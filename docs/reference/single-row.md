# `SingleRow<Columns>` and `WritableSingleRow<Columns>`

A pending query that the type system promises will return exactly
one row. Built by `Table.find(id)` (a primary-key lookup) and the
association accessors merged onto its result by `defineSchema`. If
the underlying query returns zero rows, `db.run(...)` rejects with
`RowNotFoundError` — there is no nullable variant. Callers who want
to tolerate a missing row should drop down to `.where(...)` and
inspect the resulting array.

```ts
import { WritableSingleRow, SingleRow } from "@notahat/tenon";
```

You don't usually construct either of these directly. `Table.find(id)`
produces a `WritableSingleRow<Columns>` (a `SingleRow` subclass with
`.delete()` and `.update(attrs)` methods); belongs-to accessors wired
by `defineSchema` produce plain `SingleRow<Columns>` values. Both
classes are exported so test code and helpers can name them.

## Phantoms

```ts
declare readonly _kind: "SingleRow";
declare readonly _columns: Columns;
```

`_kind` discriminates `SingleRow` from a structurally similar
`Relation` (both wrap a `node: RelationNode`); `Database.run`'s
overload set would otherwise also match a plain `Relation`.
`_columns` carries the row shape forward to `db.run`.

## `db.run` contract

| Value | `db.run(...)` resolves to |
|---|---|
| `SingleRow<C>` | `RowOf<C>` (rejects with `RowNotFoundError` when no row is returned) |
| `WritableSingleRow<C>` | `RowOf<C>` (same as `SingleRow<C>`) |

## `WritableSingleRow.delete()`

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
`WritableSingleRow` returned by `Table.find(id)`. Belongs-to
association accessors return plain `SingleRow` because their
underlying SQL is an inner join, not a flat `WHERE pk = ?` —
deleting through a join shape is out of scope for v1. Mirrors the
[`Relation`](relation.md) / [`WritableScope`](scope.md) split.

```ts
const result = await db.run(schema.posts.find(1).delete());
//    ^? { readonly rowCount: number }

// Recover the deleted body column on the way out:
const [deleted] = await db.run(
  schema.posts.find(1).delete().returning(schema.posts.body),
);
//      ^? { body: string } | undefined
```

## `WritableSingleRow.update(attrs)`

```ts
update(attrs: UpdatableAttrs<Columns>): Update<Columns, null>;
```

Build an [`Update`](update.md) targeting the same row. The wrapped
`LIMIT 1` is dropped — Postgres has no `UPDATE ... LIMIT`, and the
primary-key predicate already restricts the statement to ≤1 row.
`db.run(update)` resolves to `{ rowCount: 0 | 1 }`. Chain
`.returning(...)` to recover columns from the updated row.

Like `.delete()`, `.update(attrs)` is available only on the
`WritableSingleRow` returned by `Table.find(id)`; belongs-to
accessors return plain `SingleRow`. See
[`UpdatableAttrs`](types.md#updatableattrs) for the attrs typing.

```ts
const result = await db.run(
  schema.posts.find(1).update({ body: "edited" }),
);
//    ^? { readonly rowCount: number }
```

## `RowNotFoundError`

```ts
import { RowNotFoundError } from "@notahat/tenon";
```

Thrown by `db.run(singleRow)` when the underlying SQL returns zero
rows. `Error` subclass with `name === "RowNotFoundError"`. It is
the only signal a missing row produces — there is no nullable PK
lookup.

## Example

```ts
import { Database } from "@notahat/tenon";
import { schema } from "./schema";

const db = new Database(pool);

// Throws RowNotFoundError if the user doesn't exist.
const user = await db.run(schema.users.find(1));
//    ^? { id: number; email: string; ... }

// Tolerate-missing case: query through .where and read the array.
const [maybeUser] = await db.run(
  schema.users.where(schema.users.id.eq(1)),
);
//      ^? { id: number; email: string; ... } | undefined
```

## Association accessors

`defineSchema` merges association accessors onto the SingleRow
returned by `find`. See [`defineSchema`](define-schema.md) for the
naming rules and the `db.run` typing of has-many vs belongs-to.
Belongs-to accessors throw on missing parent (including the case
where the FK column itself is null) — callers with nullable FKs
must check the scalar before walking the accessor.
