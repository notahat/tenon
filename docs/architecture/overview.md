# Overview

How tenon is built, top to bottom.

## The pipeline

```
tenon-generate (CLI, src/introspect/)
        |
        v
generated schema file (calls defineTable + defineSchema)
        |  defineSchema wires FK accessors into each Table.find
        v
fluent classes (src/query/)
        |  build AST
        v
ast/ (src/ast/)
        |  serialise
        v
sql/serialise.ts  →  CompiledQuery { text, params }
        |
        v
executor (src/executor/Database.ts)  →  pg → Postgres
```

Everything runs in one direction. There is no read-back: the
fluent layer builds AST, the serialiser turns AST into SQL, and
the executor sends that SQL to Postgres. Each layer's output is
the next layer's input; nothing reaches back upstream.

## Functional core, imperative shell

The four bottom layers — `ast/`, `query/`, `sql/`, the
`schema-runtime/` helpers — are **pure**. They build immutable
data structures, never touch the network, never read time, and
(with one documented exception) never mutate. You can hold on to
AST nodes, compile them with `relationToSql(...)` directly,
snapshot them in tests.

Side effects live in **two places only**:

- `src/introspect/` — the `tenon-generate` CLI, which reads the
  Postgres catalog and writes a TypeScript file.
- `src/executor/Database.ts` — the `Database.run` method, which
  hands compiled SQL to a `pg.Pool` (or a `pg.PoolClient`).

This is the "functional core, imperative shell" pattern. It
keeps logic testable without infrastructure (the bulk of the
test suite is unit tests against pure functions) and makes the
small imperative perimeter easy to audit.

### The `defineSchema` exception

`defineSchema` is the one place schema-runtime breaks the
"never mutate" rule: it replaces each input Table's `find`
method in place, so every `find(id)` call returns a SingleRow
with the table's FK association accessors merged in. The
alternative — returning a fresh record of new Table objects —
would break referential identity (the `posts` you pass in
would no longer be `===` the `posts` you read out), which makes
hand-written schemas awkward and forces every Table comparison
to go through a wrapper. The mutation is bounded to one method
on each table, doesn't touch any other state, and runs once at
schema-load time.

## Where types live versus where logic lives

tenon's compile-time guarantees come from a few thick type files:

- `src/schema-runtime/columnType.ts` — the column-shape carriers.
- `src/schema-runtime/foreignKey.ts`,
  `src/schema-runtime/primaryKey.ts` — the FK / PK metadata
  shapes used by accessor inference.
- `src/query/types.ts` — `RowOf`, `MergedColumns`,
  `InsertableAttrs`, `ProjectedShape`, `ComparableTo`,
  `DuplicateColumnNames`, plus the FK-inference machinery
  (`MergedColumnsWithFkBrand`) and the FK-accessor map
  (`HasManyAccessors`, `BelongsToAccessors`, `WiredSingleRow`).
- `src/schema-runtime/defineSchema.ts` — `WiredSchema<S>`,
  `WiredTable<T, S>`. These describe the runtime mutation
  `defineSchema` performs, so the wired `find` shows up in the
  user's Table type with its associations attached.

Almost no runtime logic lives in these files. The fluent classes
(`Relation`, `Insert`, `Delete`, `WritableScope`, `SingleRow`)
carry **phantom** type parameters that thread these types through
operator chains; they don't enforce them at runtime. The `declare
readonly _xxx` fields are erased at compile time.

This split means:

- Changing a comparator's TS signature ripples through the type
  files, not the fluent classes.
- The runtime tree (AST nodes) is small and concrete; reading
  `src/ast/relation.ts` end-to-end takes a couple of minutes.
- New operators usually mean a new AST node, a new fluent method,
  and a new serialiser branch — three small additions, not a
  cross-cutting refactor.

## Reading order

If you've never seen the codebase before, start with:

1. [`ast.md`](ast.md) — the data layer. Read this first; the
   fluent layer is a thin builder over it.
2. [`fluent-layer.md`](fluent-layer.md) — the user-facing classes.
3. [`serialiser.md`](serialiser.md) — the AST-to-SQL translation.
4. [`executor.md`](executor.md) — overload dispatch in
   `Database.run`.
5. [`types-and-phantoms.md`](types-and-phantoms.md) — the
   type-level machinery, once the runtime side makes sense.
6. [`introspector.md`](introspector.md) — how the schema file
   gets built.
7. [`adding-an-operator.md`](adding-an-operator.md) — the
   end-to-end walkthrough; do this last, when the rest is in
   your head.

If you're here to extend tenon, jump to
[`adding-an-operator.md`](adding-an-operator.md) and use the
others as references.
