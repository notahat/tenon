# `Database`

The runtime that compiles tenon queries to SQL and executes them
through `pg`.

```ts
import { Database } from "@notahat/tenon";
```

## Constructor

```ts
new Database(pool: Pool): Database;
```

`pool` is a `pg.Pool`. `Database` does not own its lifecycle;
the caller is responsible for `pool.end()`.

## `db.run(query, client?)`

Compiles `query` to SQL and runs it. Five overloads, picked by the
runtime kind of `query`:

| Argument                                     | Resolves to                              |
| -------------------------------------------- | ---------------------------------------- |
| `Relation<Columns>` (no duplicate-col brand) | `Promise<RowOf<Columns>[]>`              |
| `Insert<Columns, null>`                      | `Promise<{ readonly rowCount: number }>` |
| `Insert<Columns, Returning>`                 | `Promise<RowOf<Returning>[]>`            |
| `Delete<Columns, null>`                      | `Promise<{ readonly rowCount: number }>` |
| `Delete<Columns, Returning>`                 | `Promise<RowOf<Returning>[]>`            |

Optional `client: PoolClient` routes through a specific pooled
client — typically one already inside a caller-managed
transaction. If omitted, the query runs through the pool.

A relation whose columns shape carries the duplicate-column brand
(produced by an inner join with overlapping column names) is
rejected at compile time. See [joins](../guide/joins.md).

A `Delete` with no WHERE and the empty-WHERE flag off (the bare
`Table.delete()` form) throws **before** any SQL is sent. The
error message points at `Table.deleteAll()` for the deliberate
escape hatch.

## Example

```ts
import { Pool } from "pg";
import { Database } from "@notahat/tenon";
import { users } from "./schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new Database(pool);

const rows = await db.run(users.where(users.active.eq(true)));
//    ^? Array<{ id: number; email: string; active: boolean; createdAt: Date }>

await pool.end();
```

## See also

- [Running queries guide](../guide/running-queries.md) for the
  transaction passthrough and error semantics.
- [`RowOf`](types.md#rowof) for the per-row type produced.
