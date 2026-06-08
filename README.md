# tenon

A strongly-typed, Arel-inspired query builder for PostgreSQL. You compose
queries in TypeScript, and the results are strongly typed based on your DB
schema. Things like incorrect column names, ambiguous joins, and mishandling of
nulls are caught at compile time.

> **Status: pre-alpha.** Built incrementally on `main`; nothing is
> published yet, the API still moves, and whole categories of SQL
> aren't supported (see [Scope](#scope)). Not ready to depend on.

## Your first query

The examples below use two tables: `users` (`id`, `email`, `age`) and
`posts` (`id`, `author_id`, `body`), where `posts.author_id` is a
foreign key to `users.id`.

Tenon doesn't reflect on your database at runtime. You run a generator
once that reads your schema and writes a TypeScript file, the source
of every type tenon knows about. See
[getting started](docs/using/getting-started.md) for what it emits.

```sh
tenon-generate --database-url "$DATABASE_URL" --output ./schema.ts
```

The generated file exports one value per table. Hand a
[`pg`](https://www.npmjs.com/package/pg) pool to a `Database`, import
the tables, and you're ready to query:

```ts
import { Pool } from "pg";
import { Database } from "@notahat/tenon";
import { users, posts } from "./schema";

const db = new Database(new Pool({ connectionString: process.env.DATABASE_URL }));
```

**A simple query.** Filter, order, and read rows back. The result type
is computed from the table. Note that the nullable `age` column widens
to `number | null`, so you can't forget to handle the null:

```ts
const rows = await db.run(
  users.where(users.id.in([1, 2, 3])).order(users.id.asc()),
);
//    ^? Array<{ id: number; email: string; age: number | null }>
```

**A join.** Because the generated schema carries the foreign key,
tenon fills in the `ON` clause for you, so you don't write
`posts.author_id = users.id`. `project` picks the columns you want and
fixes the shape of the result:

```ts
const stories = await db.run(
  posts.innerJoin(users).project(posts.body, users.email),
);
//    ^? Array<{ body: string | null; email: string }>
```

If a join is ambiguous (two foreign keys could connect the tables),
missing (none do), or a self-join, that's a compile-time error at the
`db.run(...)` call, not a surprise at runtime.

**Looking up a row and walking its relationships.** `find` takes a
primary key and returns a single row. The foreign key also gives you
relationship accessors: a has-many (`posts`, named for the table) and a
belongs-to (`author`, named for the `author_id` column):

```ts
const user = await db.run(users.find(1));
//    ^? { id: number; email: string; age: number | null }
//    Throws RowNotFoundError if no row has that id.

const theirPosts = await db.run(users.find(1).posts);
//    ^? Array<{ id: number; author_id: number; body: string | null }>

const author = await db.run(posts.find(1).author);
//    ^? { id: number; email: string; age: number | null }
```

**Writing.** Single-row `insert`, predicate-narrowed `update` and
`delete`, each optionally returning rows. Without `returning` you get a
`rowCount`; with it you get typed rows:

```ts
await db.run(users.insert({ email: "pete@notahat.com" }));
//    ^? { readonly rowCount: number }

const created = await db.run(
  users.insert({ email: "pete@notahat.com" }).returning(users.id, users.email),
);
//    ^? Array<{ id: number; email: string }>
```

## Where to go next

The docs split into two tracks:

- **[Using tenon](docs/using/)**: task-oriented guides for building
  queries. [getting started](docs/using/getting-started.md) (generating
  a schema and connecting), [queries](docs/using/queries.md),
  [joins](docs/using/joins.md), [writes](docs/using/writes.md),
  [relationships](docs/using/relationships.md), and the
  [type mapping](docs/using/type-mapping.md) between Postgres and
  TypeScript.
- **[How tenon works](docs/internals/)**: the internals, for working on
  tenon itself. Start with
  [the query pipeline](docs/internals/pipeline.md): a line-by-line trace
  of what happens when you run a query, from the fluent call to the rows
  coming back.

## Scope

Supported today: reads (`project`, `where`, `order`, `limit`,
`offset`, `innerJoin`), self-joins via `Table.as(alias)`, foreign-key-
inferred joins, single-row `insert`, predicate-narrowed `update` and
`delete` (all with optional `returning`), primary-key `find` (with
`.update`/`.delete` shorthand and relationship accessors). Integer and
UUID primary keys both work. PostgreSQL only.

Not yet supported: outer joins, aggregates / `group by`, set
operations, sub-queries / CTEs, text pattern matching (`LIKE` /
`ILIKE`), multi-row inserts, `ON CONFLICT`, unconditional `UPDATE`
(there's no `updateAll` counterpart to `deleteAll`), `UPDATE ... FROM`,
`DELETE ... USING`, transactions, and streaming. The AST and type
machinery are designed to absorb these without breaking changes. See
[the architecture overview](docs/internals/).

## Development

```sh
nvm use         # Node 20+
npm install
npm test        # unit + type tests
npm run typecheck
```

Integration tests connect to a real PostgreSQL via `DATABASE_URL`:

```sh
DATABASE_URL=postgres://localhost/tenon_test npm run test:integration
```
