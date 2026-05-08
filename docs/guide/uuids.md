# UUID primary keys

Tenon supports UUID primary keys with no special machinery: a
`uuid` column maps to TypeScript `string`, `Table.find(id)` accepts
the same `string`, and a column declared with a server-side
`DEFAULT` becomes optional on insert in the usual way. This page
walks the recommended pattern.

## Schema

PostgreSQL 18 ships `uuidv7()` as a core builtin. The recommended
shape for a UUID-keyed table is:

```sql
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  email text NOT NULL
);
```

`tenon-generate` will introspect this as:

```ts
export const users = defineTable(
  "public",
  "users",
  {
    id: columnType<string, "uuid">({
      nullable: false,
      hasDefault: true,
      isGenerated: false,
    }),
    email: columnType<string, "text">({
      nullable: false,
      hasDefault: false,
      isGenerated: false,
    }),
  },
  [],
  { columns: ["id"] },
);
```

`hasDefault: true` is the key flag here: it tells
[`InsertableAttrs`](inserts.md#what-goes-in-attrs) that `id` is
optional on insert.

## Insert: server-generated id

Because `id` is optional, you can omit it and let Postgres fire
`uuidv7()`:

```ts
const created = await db.run(
  users.insert({ email: "pete@notahat.com" }).returning(users.id, users.email),
);
//    ^? Array<{ id: string; email: string }>

console.log(created[0]?.id);
// '019e0776-f12b-7524-828d-7cc1f7cfbd7f'
```

## Insert: client-supplied id

If you'd rather generate the UUID in your application — for
example, so you have the id available before the round-trip — pass
it on the attrs and your value wins over the column default. The
[`uuid`](https://www.npmjs.com/package/uuid) package (v10+) is the
conventional source:

```ts
import { v7 as uuidv7 } from "uuid";

const id = uuidv7();
await db.run(users.insert({ id, email: "alice@example.com" }));

const row = await db.run(users.find(id));
//    ^? { id: string; email: string }
```

## Lookup

`Table.find(id)` works the same way it does for any other PK type:

```ts
const user = await db.run(users.find("019e0776-f12b-7524-828d-7cc1f7cfbd7f"));
//    ^? { id: string; email: string }
// Throws RowNotFoundError if no row matches.
```

## Why `string` and not a branded `Uuid` type

The column type is plain `string`, on purpose. UUIDs cross HTTP
params, JSON bodies, environment variables, and third-party
libraries — all of which give you strings — so a branded type would
force casts at every boundary for a modest type-safety win. This
also matches the existing `int8`, `numeric`, and `timestamp`
mappings; see [type mapping](type-mapping.md) for the rationale.

## See also

- [Inserts](inserts.md) — required / optional / forbidden column
  rules that make the optional-`id` insert work.
- [Relationships](relationships.md) — `Table.find(id)`, has-many,
  belongs-to.
- [Type mapping](type-mapping.md) — why `uuid` resolves to `string`.
