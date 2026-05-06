# `trel` — first draft plan

## Context

We're building `trel`: a strongly-typed, Arel-inspired relational-algebra
query library for TypeScript, targeting PostgreSQL. The repo at
`/Users/notahat/src/trel` is empty apart from `.git`, so this is greenfield.

The motivation is to compose SQL queries the way Arel lets you in Ruby —
relations as values, operators as composable transforms — but with TS
catching column typos, wrong-type comparisons, and (eventually) ambiguous
joined-column references at compile time. v1 is intentionally narrow so we
can nail the type machinery before expanding the operator surface.

## Decisions (from clarifying questions)

- **Scope:** SQL builder + executor (executes via node-postgres `pg`).
- **Dialect:** PostgreSQL only.
- **Schema source:** a CLI (`trel-generate`) introspects a live DB via
  `pg_catalog` and emits a TS schema file users import.
- **API style:** hybrid — relational-algebra primitives at the core
  (`relation.where(...)`, `relation.project(...)`), with SQL-ish sugar where
  it improves ergonomics. Joins (post-v1) read like
  `users.innerJoin(posts).on(users.id.eq(posts.authorId))`.
- **v1 operators:** `project`, `where`, `order`, `limit`, `offset`. **No
  joins, aggregates, DML, set-ops, or CTEs in v1.** The type plumbing is
  designed so joins drop in cleanly later.
- **Type-system enforcement:** column existence; column types in
  expressions; precise result-row types from `project`; join correctness
  (designed for, not yet exposed).
- **Driver:** `pg` (node-postgres). No streaming or transactions in v1
  (transactions are forward-compatible: `run(query, client?)` accepts a
  caller-managed `pg.PoolClient`).
- **Test runner:** Vitest. Unit tests are pure; integration tests gate on
  a `DATABASE_URL` to a local Postgres.
- **Package name:** `trel` as a placeholder; rename before any publish.

## Design summary

### AST is plain data

A discriminated-union of `interface` records keyed by `kind`. Pure data,
serialisable, structurally cloneable. Two top-level families:

- `RelationNode = TableRef | Project | Where | Order | Limit | Offset`
  (with `InnerJoin | LeftJoin | ...` reserved for v2).
- `ExpressionNode = ColumnRef | Literal | Parameter | BinaryOp | UnaryOp
| InList`.

Important AST invariants:

- Every `TableRef` has an alias (defaulting to the table name); every
  `ColumnRef` is qualified by alias. This makes joins drop in trivially.
- `Parameter` nodes carry the value, **not** an index. Numbering (`$1`,
  `$2`, …) is assigned by the serialiser in left-to-right emission order,
  so tree transforms never need to renumber.
- `ProjectionItem` always has an `outputName`, either user-supplied via
  `column.as("foo")` or inferred from the column name.

### Fluent layer is a thin wrapper around AST data

A small set of classes (`Relation`, `Column`, `Expression`) hold AST nodes
and carry phantom type parameters. Methods don't mutate; they return new
wrappers around new nodes. This is the functional core / imperative shell
the user's CLAUDE.md asks for: data + pure transforms inside, ergonomic
facade outside.

### Type plumbing

- A `ColumnType<TsType, SqlTag>` carries the TS type and a phantom Postgres
  type tag (`"int4"`, `"text"`, …) plus a `nullable: boolean`.
- A `ColumnsShape` is a `Readonly<Record<string, ColumnType<unknown,
string>>>` — the canonical shape that flows through every operator.
- A `Table<TableName, Columns>` is a runtime value (frozen object of
  `Column` instances) carrying the table-name literal type. The generated
  schema file builds these via `defineTable(...)`.
- A `Column<TableName, Name, Type>` carries enough info at the type level
  to build precise comparators (`ComparableTo<Type>` accepts: a raw value
  of the column's TS type, `null` only if nullable, another `Column` of
  the same column-type, or an `Expression<TsType>`).
- `Expression<TsResult>` carries its result type so `where(...)` requires
  `Expression<boolean>`.
- `project(...items)` uses a variadic tuple parameter (`<const Items
extends readonly ProjectableItem<Columns>[]>`) and a mapped type that
  walks `Items[number]`, extracting `(outputName, tsType)` pairs into a
  precise row shape. The output is itself a `ColumnsShape` so the
  projected relation can be further `.where`'d / `.project`'d.

### Postgres → TS type mapping (call-outs)

| Postgres                                  | TS                   | Notes                                  |
| ----------------------------------------- | -------------------- | -------------------------------------- |
| `int2`, `int4`                            | `number`             |                                        |
| `int8`                                    | `string`             | precision-safe; matches `pg`'s default |
| `numeric`                                 | `string`             | arbitrary precision                    |
| `float4`, `float8`                        | `number`             |                                        |
| `text`, `varchar`, `uuid`, `date`, `time` | `string`             |                                        |
| `bool`                                    | `boolean`            |                                        |
| `timestamptz`                             | `Date`               |                                        |
| `timestamp` (no tz)                       | `string`             | a `Date` would lie; document this      |
| `bytea`                                   | `Buffer`             |                                        |
| `json`, `jsonb`                           | `unknown`            | narrow at use site                     |
| array `T[]`                               | `Array<TsOf<T>>`     |                                        |
| nullable                                  | widened by `\| null` | not `\| undefined`                     |
| unknown OIDs                              | `string`             | with a comment in the generated file   |

### SQL serialiser

A pure recursive function `relationToSql(node) -> { text, params }` using
a local mutable `EmitContext` accumulator (mutation contained to one call;
externally pure). Two `switch`es (relation, expression), each
exhaustiveness-checked by TS. Identifiers are **always** double-quoted.

Chained-operator semantics for v1:

- Multiple `.where(...)` combine with `AND`.
- Multiple `.order(...)` — outer wins entirely (matches Arel; documented).
- Multiple `.limit` / `.offset` — outermost wins.

### Executor surface

```ts
class Database {
  constructor(pool: pg.Pool) {}
  async run<C extends ColumnsShape>(
    query: Relation<C>,
    client?: pg.PoolClient,
  ): Promise<RowOf<C>[]>;
}
```

Caller owns the pool's lifecycle. `RowOf<C>` is a mapped type that widens
nullable columns by `| null`. The cast is honest because the Postgres → TS
map matches what `pg`'s built-in parsers produce.

### Introspection CLI (`trel-generate`)

- One binary, flags only, no config file.
  `trel-generate --database-url $URL --schemas public --output ./src/schema.ts`
- Reads `pg_class` + `pg_namespace` + `pg_attribute` + `pg_type` (+
  `pg_constraint` for PK comments). Filters on `attnum > 0`,
  `NOT attisdropped`, `relkind IN ('r','v','m','p')`.
- Emits a single `.ts` file with `defineTable("public", "users", { ... })`
  calls. Database case is preserved (no auto camelCase). Output is fully
  overwritten on each run.

### Project layout

```
trel/
├── package.json                 # type: module, bin: trel-generate
├── tsconfig.json                # strict, ESM, Node 20+
├── vitest.config.ts             # unit + integration projects
├── eslint.config.js, .prettierrc
├── docs/plans/                  # this plan lives here once approved
├── src/
│   ├── index.ts
│   ├── ast/{relation,expression,operators}.ts
│   ├── query/{Relation,Column,Expression,types}.ts
│   ├── sql/{serialise,identifier,operators}.ts
│   ├── executor/Database.ts
│   ├── schema-runtime/{defineTable,columnType}.ts
│   └── introspect/{bin,readCatalog,mapTypes,emit}.ts
└── test/
    ├── unit/{ast,serialise}.test.ts, types.test-d.ts
    └── integration/{setup,introspect,executor}.test.ts
```

## Critical files (created during implementation)

- `src/ast/relation.ts`, `src/ast/expression.ts` — AST node types.
- `src/query/Relation.ts`, `src/query/Column.ts`, `src/query/types.ts` —
  fluent layer + type machinery.
- `src/sql/serialise.ts` — pure AST → `{text, params}` serialiser.
- `src/executor/Database.ts` — `pg`-backed executor.
- `src/schema-runtime/defineTable.ts` — runtime imported by generated
  schema files.
- `src/introspect/bin.ts` — `trel-generate` CLI entrypoint.

## Incremental commits

Each commit is reviewable, has tests, and leaves the library in a working
(if minimal) state. Per the user's CLAUDE.md: TDD for behaviour changes;
commit at the end of each step.

### Commit 1 — Repo bootstrap (no behaviour)

- Move this plan into `docs/plans/` and commit it before any code (per the
  user's CLAUDE.md rule that plans live in the project).
- `package.json` (private, ESM, Node 20+ engines, deps: `pg`, `@types/pg`,
  `vitest`, `typescript`, `eslint`, `prettier`).
- `tsconfig.json` (strict, `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`, `target: ES2022`, `module: NodeNext`).
- `vitest.config.ts` with two projects (unit fast; integration gated on
  `DATABASE_URL`).
- ESLint flat config + Prettier.
- Empty `src/index.ts`, one trivial passing unit test to prove toolchain.
- `README.md` (intent + v1 scope). `.gitignore`, `.nvmrc`.

### Commit 2 — AST data + serialiser for `TableRef`

- Full `RelationNode` and `ExpressionNode` unions (including future
  variants — they're free now).
- Factory functions for each node kind (pure).
- `relationToSql` handling only `TableRef`.
- `quoteIdent` with edge-case tests (mixed case, embedded quotes, spaces).
- Unit tests on AST factories and on serialiser output.

### Commit 3 — Schema runtime + `Column` / `Expression`

- `columnType<Ts, Tag>()` phantom carrier.
- `defineTable("schema", "name", columnsMap)` returning a runtime `Table`
  value with `Column` instances per column.
- `Column<TableName, Name, Type>` with `eq`, `neq`, `lt`, `lte`, `gt`,
  `gte`, `isNull`, `isNotNull`, `in`.
- `Expression<TsResult>` with `and`, `or`, `not`.
- Unit tests on AST construction from comparisons.
- `*.test-d.ts` type tests: `users.age.eq("bob")` is a compile error;
  `users.age.eq(42)` compiles; nullable column accepts `null`, non-nullable
  rejects it.

### Commit 4 — `Relation` wrapper + `where` / `order` / `limit` / `offset`

- `Relation<Columns>` class wrapping a `RelationNode` plus a runtime
  columns map for accessor syntax.
- Serialiser extended for `Where`, `Order`, `Limit`, `Offset`, and all
  `ExpressionNode` kinds. `Parameter` numbering via `EmitContext`.
- Unit tests: each operator alone, chained, parameter ordering, multiple
  `where`s combining with `AND`.
- Type tests: `where` requires `Expression<boolean>`; chaining preserves
  the columns shape.

### Commit 5 — `project` + executor + first integration tests

- `Relation.project<Items>(...items)` with the variadic-tuple →
  `ProjectedRow` machinery. Support `column.as("alias")`.
- Serialiser handles `Project`.
- `Database` class with `run(query, client?)`.
- Type tests for the projected row shape (single column, multi-column,
  aliased, nullable).
- **First integration tests**: against `DATABASE_URL`, create a small
  `users` table in setup, run real queries end-to-end, assert returned
  rows match expected types (via `expectTypeOf`) and values.

### Commit 6 — Introspection CLI

- `readCatalog.ts` (pg_catalog queries), `mapTypes.ts` (OID/typname →
  `{ tsType, sqlTag, nullable }`), `emit.ts` (AST → emitted file string),
  `bin.ts` (CLI argument parsing + connection).
- Wired into `package.json` `bin: trel-generate`.
- Unit tests on the type mapper (the only purely-functional core
  component).
- Integration tests: against the test database, run the generator
  programmatically, snapshot the emitted file. Smoke test the binary
  itself by spawning it.

After commit 6, v1 is complete: generate a schema file, compose typed
queries, execute them.

## Verification

After commit 6, an end-to-end smoke check:

1. `vitest run` — all unit and integration tests green (the latter requires
   a local Postgres reachable via `DATABASE_URL`).
2. `tsc --noEmit` — clean.
3. Manual smoke: with a local `DATABASE_URL` pointing at a Postgres with at
   least a `users` table:
   ```
   npx trel-generate --database-url $DATABASE_URL --output /tmp/schema.ts
   ```
   Confirm the file compiles and that
   `db.run(users.where(users.id.eq(1)).limit(1))` returns a typed row.
4. Type-error spot checks (these must fail to compile):
   - `users.id.eq("not a number")`
   - `users.where(users.id)` (not a boolean expression)
   - `users.project(users.nonexistentColumn)`

## Open questions / risks

- **Variadic tuple inference for `project`.** Needs `<const Items extends
readonly ...[]>` (TS 5+) to keep tuple types narrow. Verify with
  type-level tests in commit 5.
- **Error-message legibility under generic constraints.** Keep
  `ComparableTo` shallow, name intermediate types meaningfully. Don't
  over-engineer.
- **`int8` / `numeric` as `string`.** Will surprise users used to ORMs
  that lie. Document loudly. Provide a per-column override path later.
- **`timestamp` (no tz) as `string`.** Same. README should advise
  `timestamptz`.
- **Custom types (enums, PostGIS, hstore).** Fall back to `string` with a
  generated comment. v2 escape hatch: user-registered parsers.
- **Connection lifecycle.** `Database` does not own the pool. Document.

## Post-v1 cleanups noted during implementation

Concrete debt items observed while building v1; none block shipping.

- **`Where` predicate collection in the serialiser uses `Array.unshift`**
  to keep source-tree order, which is O(n²) for long chains of `.where`
  calls. Acceptable at v1 scale; flatten with a reverse-walk + push if
  realistic queries ever stack dozens of `.where`s.
- **`generate.ts` passes a `pg.Client` to `readCatalog` whose parameter
  is typed as `QueryRunner`.** It works structurally (Client, Pool, and
  PoolClient all expose a compatible `query` method), but a tighter
  `QueryRunner` interface that all three are explicitly assignable to —
  or a small adapter — would remove the need to lean on TS's structural
  matching. Same shape exists in `src/executor/Database.ts`.

## Deferred (post-v1)

- Joins (`innerJoin`, `leftJoin`, …) — type plumbing already accommodates.
- Aggregates + `group by` + `having`.
- Set operations (`union`, `intersect`, `except`).
- Subqueries / CTEs.
- DML (`insert`, `update`, `delete` + `returning`).
- Transactions API.
- Streaming via `pg-cursor`.
- Migrations-based codegen (alternative to live-DB introspection).
