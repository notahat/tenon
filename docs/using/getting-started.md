# Getting started

This guide takes you from a PostgreSQL database to your first query. It
covers generating a schema, connecting, and running something. The
operators themselves are covered in [queries](queries.md),
[joins](joins.md), [writes](writes.md), and
[relationships](relationships.md).

## Requirements

- Node 20 or newer.
- A PostgreSQL database you can connect to.

Tenon is pre-alpha and not published to npm yet, so there's no
`npm install` line to copy. These docs assume you have it available in
your project (for now, from a local checkout of this repository) and
that its `tenon-generate` command is on your path. The install story
will firm up once the package ships.

## Generate your schema

Tenon doesn't inspect your database at runtime. Instead, you run a
generator once that reads your schema from the Postgres catalog and
writes a TypeScript file describing every table:

```sh
tenon-generate --database-url "$DATABASE_URL" --output ./schema.ts
```

The flags:

- `--database-url` (required): a Postgres connection string.
- `--output` (required): where to write the generated file.
- `--schemas` (optional): a comma-separated list of schemas to read.
  Defaults to `public`.

The output is a plain TypeScript file you commit to your repository. It
is the single source of every type tenon knows about your data.

## The generated file

The output is a plain TypeScript file you commit and don't edit by
hand. It exports one value per table, which you import to build
queries:

```ts
import { users, posts } from "./schema";
```

The file is a static description of your tables, evaluated when your
program loads. It doesn't connect to anything by itself. For what the
column type annotations inside it mean, see [type mapping](type-mapping.md).

## Connect a database

To run queries, hand a [`pg`](https://www.npmjs.com/package/pg) pool to
a `Database`:

```ts
import { Pool } from "pg";
import { Database } from "@notahat/tenon";
import { users, posts } from "./schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new Database(pool);
```

`Database` doesn't own the pool. It never closes it, so the pool's
lifecycle is yours to manage: call `pool.end()` yourself when your
program shuts down.

## Run your first query

With the tables imported and a `Database` in hand, you can run a query.
`db.run(...)` compiles the query to SQL, executes it, and returns rows
typed to match:

```ts
const allUsers = await db.run(users.order(users.id.asc()));
//    ^? Array<{ id: number; email: string; age: number | null }>
```

That's the whole setup. The result type is computed from the table, so
the nullable `age` column comes back as `number | null`.

## Keeping the schema in sync

The generated file is a snapshot of your database structure, not a live
view. When you change your schema (add a column, add a table, add a
foreign key), rerun `tenon-generate` and commit the updated file.
TypeScript will then flag any query that no longer matches.

## Where to go next

- [Queries](queries.md): filtering, ordering, projecting, paging.
- [Joins](joins.md): inner joins, inferred and explicit, and self-joins.
- [Writes](writes.md): inserts, updates, and deletes.
- [Relationships](relationships.md): `find` and the foreign-key
  accessors that `defineSchema` wires up.
- [Type mapping](type-mapping.md): how Postgres types become TypeScript
  types, and the nullable and default rules.
