# Type mapping

The generated schema file is where Postgres types meet TypeScript. Each
column carries a small annotation that records its TypeScript type, its
Postgres type, and three flags. This guide explains those annotations,
the type mapping behind them, and the rules they drive when you read and
write rows.

## Anatomy of a column

Every column in the generated file is one `columnType` call. A `users`
table comes out looking like this:

```ts
{
  id: columnType<number, "int4">({
    nullable: false, hasDefault: true, isGenerated: false,
  }),
  email: columnType<string, "text">({
    nullable: false, hasDefault: false, isGenerated: false,
  }),
  age: columnType<number, "int4">({
    nullable: true, hasDefault: false, isGenerated: false,
  }),
}
```

The two type parameters and three flags each do one job:

- `columnType<TsType, "pgType">`. The first parameter is the TypeScript
  type you read the column as. The second is the Postgres type name it
  came from. Both are carried for the type system; the section below
  lists how one maps to the other.
- `nullable`. Whether the column can hold SQL NULL. When true, the read
  type widens by `| null`.
- `hasDefault`. Whether the column has a `DEFAULT` or is an identity
  column. This decides whether it's optional on insert.
- `isGenerated`. Whether the column is `GENERATED ALWAYS AS (...)
STORED`. A generated column can't be written at all.

You don't write these by hand. The generator reads them from the
Postgres catalog. What follows is how to read them back.

## Postgres to TypeScript

Tenon maps a fixed set of Postgres types to TypeScript:

| Postgres type                               | TypeScript |
| ------------------------------------------- | ---------- |
| `bool`                                      | `boolean`  |
| `int2`, `int4`, `float4`, `float8`          | `number`   |
| `int8`, `numeric`                           | `string`   |
| `text`, `varchar`, `char`, `bpchar`, `name` | `string`   |
| `uuid`                                      | `string`   |
| `date`, `time`, `timetz`, `timestamp`       | `string`   |
| `timestamptz`                               | `Date`     |
| `bytea`                                     | `Buffer`   |
| `json`, `jsonb`                             | `unknown`  |
| `T[]` (any array)                           | `TsType[]` |

A few choices are worth knowing:

- `int8` (bigint) and `numeric` map to `string`, not `number`, because
  they hold values that a JavaScript `number` can't represent without
  losing precision. You parse them yourself when you need arithmetic.
- Among the date and time types, only `timestamptz` maps to `Date`. The
  rest, including plain `timestamp`, come back as `string`, because they
  carry no timezone for a `Date` to anchor to.
- `json` and `jsonb` map to `unknown`, so you narrow the value before
  using it.

Any type not in this table falls back to `string`, and the generator
marks it with a comment so you can spot it and decide how to handle it.

## Nullable columns

A nullable column widens its read type by `| null`. That `age` column
above comes back as `number | null`, and the row type reflects it
everywhere it appears:

```ts
const rows = await db.run(users);
//    ^? Array<{ id: number; email: string; age: number | null }>
```

On the write side, a nullable column accepts `null` as well as its base
type, so you can store a null explicitly.

## What you can insert and update

The `hasDefault` and `isGenerated` flags decide a column's status when
you insert. Each column is one of three:

- **Required.** NOT NULL, no default, not generated. You must supply it.
- **Optional.** Nullable, or has a default. You may supply it or leave
  it out. A nullable optional column also accepts `null`; a non-nullable
  one with a default does not, since omitting it is how you get the
  default.
- **Forbidden.** Generated. You can't supply it at all, and trying to is
  a compile error.

So for the `users` table above, `email` is required, `age` and `id` are
optional (`age` is nullable, `id` has a default), and a generated column
would be absent from the insert type entirely.

Update is simpler. Every non-generated column is optional, and nullable
ones accept `null`. Defaults don't enter into it, because a default only
applies when a row is first inserted.

## UUID primary keys

A `uuid` column is just a `string` on the TypeScript side. The
interesting part is where the value comes from.

On PostgreSQL 18 and later, `uuidv7()` is a built-in function you can
use as a column default:

```sql
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  email text NOT NULL
);
```

With that default, `id` has `hasDefault: true`, so it's optional on
insert and the database fills it in:

```ts
await db.run(users.insert({ email: "a@example.com" }));
```

You can also supply the value from the client, which works on any
Postgres version. The `uuid` package's v7 generator returns a string
that goes straight into the column:

```ts
import { v7 as uuidv7 } from "uuid";

await db.run(users.insert({ id: uuidv7(), email: "a@example.com" }));
```

## Where to go next

- [Getting started](getting-started.md): generating the schema file
  these annotations live in.
- [Writes](writes.md): the insert and update operators these rules
  govern.
- [The schema runtime](../internals/schema-runtime.md): how
  `columnType`, `defineTable`, and `defineSchema` fit together inside.
