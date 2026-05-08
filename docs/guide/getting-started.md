# Getting started

Install tenon, generate a typed schema from your database, and run
your first query.

## Install

```sh
npm install @notahat/tenon pg
```

`pg` is a peer dependency. tenon talks to Postgres through a `pg`
`Pool`; it doesn't bundle its own driver.

## Generate a schema

`tenon-generate` reads the catalog of a live Postgres database and
writes a TypeScript module describing every table and column. That
module is what your application code imports.

Point it at your database and tell it where to write the output:

```sh
npx tenon-generate \
  --database-url postgres://localhost/myapp_dev \
  --schemas public \
  --output src/schema.ts
```

`--schemas` is optional and defaults to `public`; pass a
comma-separated list to introspect more than one (e.g.
`--schemas public,billing`).

The generated file is committed to source control. Re-run
`tenon-generate` after every database migration. Don't edit it by
hand — your changes will be lost on the next regeneration. See the
[schema and introspection guide](schema-and-introspection.md) for
details on what gets emitted and why.

## Connect

Build a `pg.Pool` and wrap it in a `Database`:

```ts
import { Pool } from "pg";
import { Database } from "@notahat/tenon";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new Database(pool);
```

`Database` is the only thing that talks to `pg`. Everything else
in tenon is pure: queries are values you build up and then hand to
`db.run(...)`.

## Run a query

```ts
import { users } from "./schema";

const activeUsers = await db.run(
  users.where(users.active.eq(true)).order(users.createdAt.desc()).limit(10),
);
//    ^? Array<{ id: number; email: string; active: boolean; createdAt: Date }>
```

The chain reads left to right: start from a table, narrow with
`where`, sort with `order`, cap with `limit`. The result type is
inferred from the columns of `users`; if you mistype a column name
or compare a `boolean` column against a string, TypeScript catches
it before the query is built.

## Where to go next

- [Queries](queries.md) for the read-side operators in depth.
- [Joins](joins.md) for `innerJoin(...).on(...)` and self-joins.
- [Inserts](inserts.md) and [deletes](deletes.md) for write
  operations.
- [Type mapping](type-mapping.md) for the cases where Postgres
  types don't have a clean JavaScript equivalent (`int8`,
  `numeric`, `timestamp` without time zone).
