# Architecture

How tenon is built. The pipeline runs in one direction:

```
tenon-generate (CLI)
        |
        v
generated schema file  →  schema-runtime (defineTable, columnType)
        |
        v
fluent classes (Relation, Insert, Delete, WritableScope, ...)
        |
        v  build AST
ast/ (RelationNode, ExpressionNode, InsertNode, DeleteNode)
        |
        v  serialise
sql/serialise.ts  →  CompiledQuery { text, params }
        |
        v
executor (Database.run)  →  pg → Postgres
```

Pages, in reading order:

1. [Overview](overview.md) — the pipeline, the functional core /
   imperative shell organising principle, and where types live
   versus where logic lives.
2. [AST](ast.md) — the data layer. Plain TypeScript shapes for
   relations, expressions, inserts, and deletes.
3. [Fluent layer](fluent-layer.md) — the user-facing classes that
   build AST nodes. Phantom fields and what they buy.
4. [Serialiser](serialiser.md) — pure functions that turn AST
   nodes into parameterised SQL.
5. [Executor](executor.md) — `Database.run` overload dispatch.
6. [Types and phantoms](types-and-phantoms.md) — the type-level
   machinery: `ColumnsShape`, `ColumnType`, `RowOf`,
   `MergedColumns`, the duplicate-column brand.
7. [Introspector](introspector.md) — what `tenon-generate` does
   at runtime and how to extend the type map.
8. [Adding an operator](adding-an-operator.md) — concrete
   walkthrough using DELETE as the worked example.
