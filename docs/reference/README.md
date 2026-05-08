# Reference

Per-symbol API reference for every public export of
`@notahat/tenon` and `@notahat/tenon/schema-runtime`, plus the
`tenon-generate` CLI.

## Main entry — `@notahat/tenon`

- [`Database`](database.md) — runs queries against a `pg` pool.
- [`Relation`](relation.md) — composable read operators
  (`project`, `where`, `order`, `limit`, `offset`, `innerJoin`).
- [`Table`](table.md) — the merged Relation + columns shape
  returned by `defineTable`. Carries `.as`, `.insert`, `.where`,
  `.delete`, `.deleteAll`. The scope returned by `.where` adds
  `.update` and `.delete` on top.
- [`Column`, `AliasedColumn`, `Expression`](column-and-expressions.md) —
  column references and comparison operators.
- [`Ordering`](ordering.md) — `.asc` / `.desc`.
- [`JoinBuilder`](join-builder.md) — the partial-application
  helper between `.innerJoin(...)` and `.on(...)`.
- [`Insert`](insert.md) — INSERT statements with optional
  `RETURNING`.
- [`Update`](update.md) — UPDATE statements with optional
  `RETURNING`, accessed through `WritableScope.update` and
  `WritableSingleRow.update`.
- [`Delete`, `WritableScope`](delete.md) — DELETE statements
  with optional `RETURNING` and the empty-WHERE guard.
- [`SingleRow`, `SingleRowOrThrow`, `RowNotFoundError`](single-row.md) —
  primary-key lookup results from `Table.find(id)`.
- [`scope`, `Scope`](scope.md) — the `scope(...)` factory and
  type alias.
- [Public type helpers](types.md) — `RowOf`, `ProjectableItem`,
  `ProjectedShape`, `MergedColumns`, `InsertableAttrs`,
  `UpdatableAttrs`, `ComparableTo`.

## Schema runtime — `@notahat/tenon/schema-runtime`

- [`columnType`, `defineTable`, `ColumnType`, `ColumnsShape`,
  `Table`, `PrimaryKey`](schema-runtime.md) — the surface imported
  by generated schema files.
- [`defineSchema`, `WiredSchema`, `WiredTable`](define-schema.md) —
  wires association accessors onto each `Table.find` result.

## CLI

- [`tenon-generate`](tenon-generate.md) — introspect a live
  Postgres database and emit a typed schema file.
