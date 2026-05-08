# Introspector

`src/introspect/` — the CLI that produces the generated schema
file. The only place in tenon that reads from `pg_catalog`, and
one of two places that performs side effects (the other is
`Database`).

## Pipeline

```
bin.ts (CLI argv parsing)
    |
    v
generate.ts: GenerateOptions  →  open pg.Client
    |
    v
readCatalog.ts: pg_catalog queries  →  { columns, foreignKeys }
    |
    v
emit.ts: catalog data  →  TypeScript file string
    |
    v
generate.ts: writeFile
    |
    v
bin.ts: success message on stdout
```

`bin.ts` and `generate.ts` are imperative; `readCatalog.ts`,
`emit.ts`, and `mapTypes.ts` are pure (data in, data out). The
`generate.ts` orchestrator owns the pg connection lifecycle —
opens, runs the catalog query, closes — so callers don't have to.

`generate.ts` is exposed as a programmatic API
(`generateSchema(options)`) so tests can drive the same code
path as the CLI.

## `bin.ts` — argument parsing

Parses three flags: `--database-url` (required), `--schemas`
(optional, defaults to `public`, comma-separated), `--output`
(required). Bad arguments write the usage line to stderr and
exit `2`. Anything else propagates as an uncaught exception.

No config file. No environment variable shortcuts. No filters
beyond the schema list. The principle is "add surface area only
when a second consumer requests it."

## `readCatalog.ts` — the catalog query

A single SQL string against `pg_catalog`:

```sql
SELECT
  n.nspname        AS schema,
  c.relname        AS table_name,
  a.attname        AS column_name,
  t.typname        AS typname,
  NOT a.attnotnull AS nullable,
  (a.atthasdef OR a.attidentity <> '') AS has_default,
  (a.attgenerated <> '')               AS is_generated
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid
JOIN pg_type      t ON t.oid = a.atttypid
WHERE n.nspname = ANY($1::text[])
  AND c.relkind IN ('r', 'v', 'm', 'p')
  AND a.attnum  > 0
  AND NOT a.attisdropped
ORDER BY n.nspname, c.relname, a.attnum
```

A few choices worth knowing:

- **`pg_catalog` over `information_schema`.** Direct access to
  `typname` (the introspector reads "this is `int4`" rather than
  "this is `integer`" or "this is the formatted name"); also
  conventionally faster.
- **`relkind IN ('r', 'v', 'm', 'p')`.** Tables, views,
  materialised views, partitioned tables. SQL doesn't really
  distinguish them at the column layer; tenon treats them all as
  table-like.
- **`a.attnum > 0` AND `NOT a.attisdropped`.** Excludes system
  columns (`oid`, `xmin`, ...) and dropped-but-not-vacuumed
  columns.
- **`a.atthasdef OR a.attidentity <> ''` for `hasDefault`.** A
  serial column (or `GENERATED ... AS IDENTITY`) doesn't have a
  literal `DEFAULT` clause — `attidentity` is the catalog's
  signal. The OR captures both, so identity columns flow through
  to the schema runtime as "optional in inserts" the way
  `DEFAULT`-bearing columns do.
- **`a.attgenerated <> ''` for `isGenerated`.** Captures `GENERATED
ALWAYS AS (...) STORED` columns, which cannot be inserted at
  all — `InsertableAttrs` filters them out entirely.

Result rows are ordered by `(schema, table, attnum)` so downstream
emitters can preserve column order within each table without
re-sorting.

A second query reads foreign-key constraints from
`pg_constraint`:

```sql
SELECT
  con.conname        AS name,
  rel_n.nspname      AS schema,
  rel_c.relname      AS table_name,
  array_agg(rel_a.attname::text ORDER BY i) AS columns,
  ref_n.nspname      AS referenced_schema,
  ref_c.relname      AS referenced_table,
  array_agg(ref_a.attname::text ORDER BY i) AS referenced_columns
FROM pg_constraint con
JOIN pg_class      rel_c ON rel_c.oid = con.conrelid
JOIN pg_namespace  rel_n ON rel_n.oid = rel_c.relnamespace
JOIN pg_class      ref_c ON ref_c.oid = con.confrelid
JOIN pg_namespace  ref_n ON ref_n.oid = ref_c.relnamespace
JOIN LATERAL generate_subscripts(con.conkey, 1) AS i ON true
JOIN pg_attribute  rel_a
  ON rel_a.attrelid = con.conrelid AND rel_a.attnum = con.conkey[i]
JOIN pg_attribute  ref_a
  ON ref_a.attrelid = con.confrelid AND ref_a.attnum = con.confkey[i]
WHERE con.contype = 'f'
  AND rel_n.nspname = ANY($1::text[])
GROUP BY con.oid, con.conname,
         rel_n.nspname, rel_c.relname,
         ref_n.nspname, ref_c.relname
ORDER BY rel_n.nspname, rel_c.relname, con.conname
```

Notes:

- **`generate_subscripts`** fans `conkey`/`confkey` out into one
  row per (referencing column, referenced column) pair, then
  `array_agg(... ORDER BY i)` re-aggregates back into paired
  arrays. Composite FKs come back with `columns.length > 1`.
- **`::text` cast** — `attname` is the Postgres `name` type, not
  `text`. `pg`'s default array decoder returns `name[]` columns
  as a string like `"{author_id}"` rather than a JS array. The
  cast forces a `text[]` shape that pg parses correctly.
- **Filtering by referencing schema only.** A FK whose referenced
  table sits in a schema that isn't in the introspection list is
  still recorded (the FK belongs to the table in the listed
  schema). Cross-schema FKs round-trip faithfully.

The combined return shape:

```ts
interface Catalog {
  readonly columns: readonly CatalogColumn[];
  readonly foreignKeys: readonly CatalogForeignKey[];
}
```

## `mapTypes.ts` — Postgres `typname` → TypeScript

A small explicit lookup (the table is in
[`type-mapping.md`](../guide/type-mapping.md)). Unknown types
fall back to `string` and the `MappedType.isFallback` flag flips
on so the emitter can include a `// unknown Postgres type "..."`
comment.

Array types in Postgres carry an underscore prefix on their
`typname` (`_int4` for `int4[]`). `mapPostgresType` recognises
the prefix, recursively maps the element, and wraps in `T[]`.

To extend the type map: add an entry to `SCALAR_TS_TYPE` in
`mapTypes.ts`. That's it. There's no plug-in mechanism —
extension means editing tenon. (A configurable map is on the
roadmap; until then, fork or open an issue.)

## `emit.ts` — the file builder

Pure: takes `CatalogColumn[]`, returns a `string`. The caller
writes it to disk.

For each `(schema, table)` group:

```ts
export const <exportName> = defineTable(<schema>, <table>, {
  <column>: columnType<<tsType>, "<sqlTag>">({
    nullable: <bool>,
    hasDefault: <bool>,
    isGenerated: <bool>,
  }),  // [<fallback comment if applicable>]
  ...
}, [
  // single-column FKs only — composite FKs are skipped at emit
  // with a comment.
  {
    name: "<constraintName>",
    columns: ["<col>"],
    referencedSchema: "<schema>",
    referencedTable: "<table>",
    referencedColumns: ["<col>"],
  },
  ...
]);
```

`exportName` is sanitised: non-identifier characters become
underscores, a leading digit is prefixed with `_`. Database
case is preserved otherwise; `users` stays `users`,
`UserSessions` stays `UserSessions`.

The fourth `defineTable` argument is omitted entirely when the
table has no single-column FKs. Composite FKs get a two-line
generated comment above the table:

```
// Skipped composite foreign key "..." on (col1, col2) referencing
// schema.table:
// composite FKs are not yet surfaced in tenon's type-level inference.
```

The header is fixed:

```ts
// This file is generated by tenon-generate. Do not edit by hand.
// Re-run `tenon-generate` after schema migrations.

import { columnType, defineTable } from "@notahat/tenon/schema-runtime";
```

Always the same module path. The schema-runtime subpath exists
so the generated file's imports don't muddy the main entry
point.

## `generate.ts` — the orchestrator

```ts
export async function generateSchema(options: GenerateOptions): Promise<void>;
```

Open a `pg.Client`, run the catalog query, build the file string,
write it. The client is fully closed in a `finally` before the
function returns — leaking a connection from a CLI invocation
would be unfortunate.

This is the seam at which tooling can drive the introspector
without going through the CLI: tests use it to generate fixture
schemas; consumers could embed it in their build pipeline if
they prefer it over `npx tenon-generate`.

## What the introspector does **not** do

- **Read application code.** It only reads `pg_catalog`.
- **Diff against an existing schema file.** Each run produces a
  fresh file and overwrites the output path.
- **Filter beyond the `--schemas` list.** Inclusion / exclusion
  by table name is intentionally absent.
- **Resolve domain types.** A column whose `typname` is a domain
  is treated as that domain (which usually falls back to
  `string`). Resolving to the underlying base type would need
  another `pg_catalog` join; deferred until someone needs it.
- **Cache.** Every invocation makes a fresh connection.
