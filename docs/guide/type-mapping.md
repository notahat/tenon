# Type mapping

How `tenon-generate` maps Postgres types to TypeScript, and why
some types come back as `string` rather than the obvious choice.

## The default map

`tenon-generate` recognises the following Postgres types:

| Postgres `typname` | TypeScript | Notes                                         |
| ------------------ | ---------- | --------------------------------------------- |
| `bool`             | `boolean`  |                                               |
| `int2`             | `number`   |                                               |
| `int4`             | `number`   |                                               |
| `int8`             | `string`   | Lossless representation past 2^53.            |
| `float4`           | `number`   |                                               |
| `float8`           | `number`   |                                               |
| `numeric`          | `string`   | Arbitrary precision; not safe as a JS number. |
| `text`             | `string`   |                                               |
| `varchar`, `char`  | `string`   |                                               |
| `bpchar`           | `string`   |                                               |
| `name`             | `string`   |                                               |
| `uuid`             | `string`   |                                               |
| `date`             | `string`   | No JS equivalent that isn't a UTC instant.    |
| `time`, `timetz`   | `string`   | Same.                                         |
| `timestamp`        | `string`   | Without time zone — a UTC `Date` would lie.   |
| `timestamptz`      | `Date`     | Always a UTC instant; safe.                   |
| `bytea`            | `Buffer`   |                                               |
| `json`, `jsonb`    | `unknown`  |                                               |
| `_<element>`       | `T[]`      | Array types — element resolved recursively.   |

Anything else falls back to `string` and the generated file
carries a `// unknown Postgres type "..."` comment so you can
either add it to the map or accept the fallback.

## Why `string` for the integer-and-decimal types

JavaScript's `number` is a 64-bit float. It can losslessly
represent integers up to 2^53, after which precision is silently
lost — `9007199254740993` round-trips as `9007199254740992`.
Postgres `int8` is a signed 64-bit integer, so values past that
threshold are common and have to round-trip exactly.

`numeric` is arbitrary-precision and exact by definition.
Forcing it through `Number(...)` would be wrong even more often
than `int8`.

In both cases the mapping is `string`. That matches `pg`'s
default parser behaviour: `pg-types` returns `int8` and `numeric`
as strings out of the box.

If you know your application's `int8` columns will never approach
2^53 (counters, FKs to identity columns, ...), you can teach
`pg-types` to parse them as `Number` for you. tenon will still
read them as `string` per the generated schema; this is a
reasonable safety default. A future iteration may add a
configurable parser map.

## Why `string` for `timestamp` (without time zone)

A JavaScript `Date` represents a UTC instant. A Postgres
`timestamp` without time zone represents a wall-clock time with
no zone information. Forcing it into a `Date` would mean choosing
a zone — usually the server's local zone, which is rarely the one
the data was written in.

The honest mapping is `string`. If you want a `Date`-typed
timestamp, use `timestamptz` (with time zone), which carries the
zone explicitly.

## Why `unknown` for `json` / `jsonb`

`pg` parses JSON columns into JavaScript values, but the _shape_
of those values is application-specific. `unknown` forces you to
narrow before using the value (e.g. via a runtime validator like
`zod`), which is what you want at the boundary anyway.

If you genuinely have a JSON column with a fixed shape, parse it
explicitly:

```ts
import { z } from "zod";

const profileShape = z.object({
  bio: z.string(),
  links: z.array(z.string().url()),
});

const rows = await db.run(users.project(users.id, users.profile));
const profiles = rows.map((row) => ({
  id: row.id,
  profile: profileShape.parse(row.profile),
}));
```

(The zod example is illustrative; tenon doesn't ship validators.)

## Custom types and the fallback

Postgres supports user-defined enums, ranges, composite types,
PostGIS geometries, hstore, and many others. tenon's default map
doesn't know about any of them — they fall back to `string`. The
generated schema file includes a comment on each such column so
the situation is visible:

```ts
status: columnType<string, "subscription_status">({
  nullable: false,
  hasDefault: false,
  isGenerated: false,
}), // unknown Postgres type "subscription_status"; falling back to string
```

This is usually fine: enums are textual on the wire, and a
`string` typed as a union of literals (via your application code,
not the generator) gives you most of the type safety. A
configurable mapping mechanism is on the roadmap; until then,
edit your application code to narrow at the boundary.

## See also

- [`tenon-generate`](../reference/tenon-generate.md) — the CLI
  that emits the column types.
- [`schema-runtime`](../reference/schema-runtime.md) for
  `columnType` and `ColumnType`.
- [UUID primary keys](uuids.md) — applying the `string` mapping to
  a UUID-keyed table with PG18's `uuidv7()` default.
