# Running queries

How `Database.run(...)` resolves each kind of query and what to
expect at the seams with `pg`.

## Constructing a `Database`

```ts
import { Pool } from "pg";
import { Database } from "@notahat/tenon";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new Database(pool);
```

`Database` does **not** own the lifecycle of the pool you hand
it. You created the pool; you call `pool.end()` when you're done.
That keeps tenon out of the lifecycle business and lets you share
a single pool with other Postgres-talking code (e.g. migrations).

## What `.run(...)` returns

The return type of `db.run(query)` depends on the kind of query
you pass:

| Query                        | Resolves to                     |
| ---------------------------- | ------------------------------- |
| `Relation<Columns>`          | `Array<RowOf<Columns>>`         |
| `Insert<Columns, null>`      | `{ readonly rowCount: number }` |
| `Insert<Columns, Returning>` | `Array<RowOf<Returning>>`       |
| `Delete<Columns, null>`      | `{ readonly rowCount: number }` |
| `Delete<Columns, Returning>` | `Array<RowOf<Returning>>`       |

The dispatch is by `instanceof` — the runtime knows which class it
got — and the overload set on `.run` keeps the return type
precise at the call site.

`RowOf<Columns>` is the row type matching the columns shape:
each key is a column name, nullable columns widen by `| null`,
and `readonly` is stripped so you can mutate the returned objects
freely. See the [type mapping guide](type-mapping.md) for how
Postgres types map to TypeScript on the JS side.

## Routing through a specific pooled client

`run` takes an optional `PoolClient`. Hand one in when you're
managing your own transaction:

```ts
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const removed = await db.run(
    users.where(users.id.eq(42)).delete().returning(users.id),
    client,
  );
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
}
```

tenon doesn't yet wrap transactions itself — there's no
`db.transaction(async (txn) => { ... })` helper — but the
`PoolClient` passthrough lets you build whatever transaction
shape your application needs. A first-class transactions API is
deferred to a later iteration.

## Errors

tenon does not catch or transform errors from `pg`. A
constraint violation, a connection failure, or a syntax error
all propagate out of `.run(...)` as the error `pg` produced.

A few errors come from tenon itself, before any SQL is sent:

- `DELETE without a WHERE clause is forbidden. ...` — see the
  [empty-WHERE guard](deletes.md#the-empty-where-guard).
- `innerJoin's right side must be a defined table ...` — only
  `defineTable(...)` values may appear on the right of an inner
  join.

These are programming errors, not runtime conditions. They throw
synchronously at construction or serialisation time.

## What's not yet supported

- **Transactions.** Use the `PoolClient` passthrough until tenon
  ships a wrapper.
- **Streaming / cursors.** `.run` always materialises the full
  result set into a JavaScript array.
- **Custom type parsers.** tenon trusts `pg`'s default parsers.
  If you need custom parsing, attach a parser to the pool itself
  via `pg-types`.
