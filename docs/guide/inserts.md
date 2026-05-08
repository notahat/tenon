# Inserts

Single-row `INSERT` with optional `RETURNING`, accessed via
`Table.insert(...)`.

Multi-row inserts, `ON CONFLICT`, and the Rails-style
`Table.where(...).insert(attrs)` chain are deferred.

## The basic shape

```ts
const result = await db.run(
  users.insert({ email: "pete@notahat.com", active: true }),
);
//    ^? { rowCount: number }
```

`Table.insert(attrs)` returns an `Insert` value. Until you hand
it to `db.run(...)`, nothing happens. Without `.returning(...)`,
the executor resolves to `{ rowCount: number }`.

## What goes in `attrs`

The shape of `attrs` is derived from the table's columns. Each
column falls into one of three buckets:

- **Required** — NOT NULL, no DEFAULT, not generated. You **must**
  supply it.
- **Optional** — nullable, OR has a DEFAULT (including identity
  columns). You **may** supply it; if you don't, Postgres uses
  the default (or NULL for nullable columns without a default).
  Nullable optional columns also accept `null`.
- **Forbidden** — `GENERATED ... STORED`. Absent from the attrs
  type entirely. Supplying one is a "no such property" type
  error.

Given a `users` table with `id serial`, `email text NOT NULL`,
`active boolean NOT NULL DEFAULT true`, and a generated
`displayName text GENERATED ALWAYS AS (...)`:

```ts
users.insert({ email: "pete@notahat.com" });
// id is optional (serial / has default), active is optional
// (has default), displayName is forbidden, email is required.

users.insert({ email: "pete@notahat.com", active: false });
// active explicitly overrides the default.

users.insert({});
// Type error: 'email' is required.

users.insert({ email: "pete@notahat.com", displayName: "Pete" });
// Type error: 'displayName' does not exist on the attrs type.
```

The metadata that drives this comes from `tenon-generate`. See
the [schema and introspection guide](schema-and-introspection.md)
for what each flag means and where it comes from in the database
catalog.

## Reading back inserted rows with `RETURNING`

Chain `.returning(...)` to pull columns of the inserted row back:

```ts
const created = await db.run(
  users
    .insert({ email: "pete@notahat.com", active: true })
    .returning(users.id, users.createdAt),
);
//    ^? Array<{ id: number; createdAt: Date }>
```

`returning` accepts the same kinds of items as `Relation.project`:
bare `Column` references and `column.as("name")` aliased columns.
The result is always an array, even though the insert produced a
single row, so the type stays consistent with the `RETURNING`
form on `DELETE`.

## Without `RETURNING`

```ts
const result = await db.run(
  users.insert({ email: "two@notahat.com", active: true }),
);
//    ^? { readonly rowCount: number }
```

`rowCount` will be `1` for a successful single-row insert. tenon
doesn't currently expose `INSERT ... ON CONFLICT DO NOTHING`, so
in practice an unsuccessful insert is one that throws (uniqueness
violation, FK violation, ...). Errors propagate from `pg`
unchanged.
