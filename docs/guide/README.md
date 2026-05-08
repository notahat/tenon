# Guide

Task-oriented walkthroughs. Read in order if you're new; jump to
the relevant page if you're not.

1. [Getting started](getting-started.md) — install tenon, point
   `tenon-generate` at a database, run your first query.
2. [Schema and introspection](schema-and-introspection.md) — what
   `tenon-generate` produces and when to regenerate.
3. [Queries](queries.md) — `Relation` and the read operators
   (`project`, `where`, `order`, `limit`, `offset`).
4. [Expressions](expressions.md) — column references, comparison
   operators, `.as("alias")`.
5. [Joins](joins.md) — `innerJoin(...).on(...)`, self-joins via
   `Table.as(...)`, the duplicate-column compile error.
6. [Relationships](relationships.md) — `Table.find(id)`,
   has-many and belongs-to accessors via `defineSchema`.
7. [Inserts](inserts.md) — `Table.insert(attrs)` and
   `.returning(...)`.
8. [Updates](updates.md) — `Table.where(...).update(attrs)`,
   `Table.find(id).update(attrs)`, `.returning(...)`.
9. [Deletes](deletes.md) — `Table.where(...).delete()`,
   `.deleteAll()`, the empty-WHERE guard.
10. [Running queries](running-queries.md) — constructing a
    `Database`, what `.run()` returns, transactions.
11. [Type mapping](type-mapping.md) — how Postgres types map to
    TypeScript and why some types are returned as `string`.

For full per-symbol details see the
[reference](../reference/README.md). For internals see
[architecture](../architecture/README.md).
