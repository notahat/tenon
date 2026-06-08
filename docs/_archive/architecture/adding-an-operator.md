# Adding an operator

End-to-end walkthrough using `DELETE` (the v1.8 increment) as the
worked example. Follow the same shape for `UPDATE`, outer joins,
`ON CONFLICT`, or any other addition.

If you've read [overview.md](overview.md), [ast.md](ast.md),
[fluent-layer.md](fluent-layer.md), [serialiser.md](serialiser.md),
and [executor.md](executor.md), this page is the assembly
instructions.

## The shape of an iteration

For most operators you'll touch six places, in this order:

1. **AST node** in `src/ast/<name>.ts` — the data shape and a
   pure factory.
2. **Serialiser branch** in `src/sql/serialise.ts` — the AST →
   SQL emitter.
3. **Fluent class** in `src/query/<Name>.ts` — the user-facing
   builder.
4. **Schema-runtime wiring** in
   `src/schema-runtime/defineTable.ts` (only when the operator
   hangs off a base table — INSERT, DELETE, future UPDATE).
5. **Executor overload** in `src/executor/Database.ts` — the
   `.run` overload set and the `instanceof` cascade branch.
6. **Public exports** in `src/index.ts`.

Tests at every layer:

- `test/unit/<name>.test.ts` — AST factory shape.
- `test/unit/<name>-serialise.test.ts` — emitter behaviour,
  including parameter numbering and edge cases.
- `test/unit/<name>-types.test-d.ts` — type-level expectations
  (compile-time errors documented with `@ts-expect-error`).
- `test/integration/<name>.test.ts` — end-to-end against a
  real Postgres test database.

Plan files for every iteration go in `docs/plans/` so the
decisions are reviewable in isolation. See `v1.7-insert-basic.md`,
`v1.8-delete-basic.md` for the two most recent examples.

## DELETE, step by step

### 1. AST: `src/ast/delete.ts`

```ts
export interface DeleteNode {
  readonly kind: "Delete";
  readonly target: TableRef;
  readonly predicates: readonly ExpressionNode[];
  readonly allowEmptyPredicates: boolean;
  readonly returning: readonly ProjectionItem[] | null;
}

export function deleteNode(args: { ... }): DeleteNode { ... }
```

Decisions made at this layer:

- **Sibling, not member.** `DeleteNode` is its own top-level
  type, not a `RelationNode` variant. Keeps the SELECT
  serialiser focused on relations.
- **Flat predicate list.** Predicates are AND-ed in array order
  at emit time. Easier than walking a nested `Where(Where(...))`
  chain and makes the empty-WHERE guard trivial.
- **`allowEmptyPredicates` on the node.** Lives on the data so
  every code path that reaches the serialiser is guarded —
  including any future tooling that builds `DeleteNode` directly.

### 2. Serialiser: `emitDelete` in `src/sql/serialise.ts`

```ts
export function deleteToSql(node: DeleteNode): CompiledQuery {
  const context: EmitContext = { params: [] };
  const text = emitDelete(node, context);
  return { text, params: context.params };
}

function emitDelete(node: DeleteNode, context: EmitContext): string {
  if (node.predicates.length === 0 && !node.allowEmptyPredicates) {
    throw new Error("DELETE without a WHERE clause is forbidden. ...");
  }
  // Emit:
  //   DELETE FROM <target> [WHERE ...] [RETURNING ...]
  // Reuses emitTableRef, emitPredicates, emitSelectList.
}
```

A few rules to follow:

- **Reuse the existing emit helpers** (`emitTableRef`,
  `emitPredicates`, `emitSelectList`, `emitExpression`,
  `quoteIdent`) rather than writing parallel ones. They thread
  parameters through `EmitContext` correctly.
- **Parameter numbering is implicit.** Don't allocate `$N`
  yourself; emit `Parameter` nodes through `emitExpression` and
  let `EmitContext.params.length` produce the index.
- **Throw before any SQL is sent** for invariant violations.
  The empty-WHERE guard lives here, not in the fluent layer.
- **Decide alias preservation explicitly.** INSERT drops the
  target's alias because predicates don't reference it; DELETE
  preserves it because they do.

### 3. Fluent: `Delete.ts` and `WritableScope.ts`

Two classes:

- `Delete<Columns, Returning>` wraps the AST node and exposes
  `.returning(...)`. Phantoms `_columns` and `_returning` carry
  through to overload resolution.
- `WritableScope<Alias, Columns> extends Relation<Columns>`
  carries the where-narrowing chain and the eventual
  `.delete()`. Overrides `.where` so the scope stays alive
  across chained predicates; the inherited `.order`, `.limit`,
  etc. widen back to plain `Relation` (which doesn't carry
  `.delete`).

`WritableScope.delete()` walks its node back through the
`Where` chain to the root `TableRef` and pulls out the
predicates. The walk is local to the scope; nothing else needs
it.

### 4. Schema-runtime: `defineTable.ts`

`Table<Alias, Columns>` grows three method types:

```ts
where(predicate): WritableScope<Alias, Columns>;  // override
delete(): Delete<Columns, null>;
deleteAll(): Delete<Columns, null>;
```

The `.where` override on `Table` requires changing the
intersection from `Relation<Columns> & ...` to
`Omit<Relation<Columns>, "where"> & ...` — the inherited
`.where` and the new one would otherwise conflict. (We tried it
without `Omit` first; tsc surfaced the conflict, so we backed
off to `Omit`.)

Runtime: `buildTable` adds three methods to the merged object,
each producing the right AST node. `Table.delete()` produces a
`DeleteNode` with `allowEmptyPredicates: false` — it's a footgun
catch, not a usable path.

### 5. Executor: `Database.ts`

Two new overloads, **before** the Insert overloads (the
ordering is by class but readers expect a top-down read):

```ts
run<C, R>(remove: Delete<C, R>, client?: PoolClient): Promise<RowOf<R>[]>;
run<C>(remove: Delete<C, null>, client?: PoolClient): Promise<{ readonly rowCount: number }>;
```

Returning-bearing overload **before** the null-returning one —
TypeScript picks the first match.

`instanceof Delete` branch in the cascade:

```ts
if (query instanceof Delete) {
  const compiled = deleteToSql(query.node);
  const result = await runner.query(compiled.text, [...compiled.params]);
  if (query.node.returning === null) return { rowCount: result.rowCount ?? 0 };
  return result.rows;
}
```

Identical shape to the Insert branch, swapping `deleteToSql` for
`insertToSql`.

### 6. Exports: `src/index.ts`

```ts
export { Delete } from "./query/Delete.js";
export { WritableScope } from "./query/WritableScope.js";
```

Test code and consumer helpers may want to name these classes;
omitting them from the entry would force consumers to dig into
internal paths.

## Tests

Four new test files for v1.8 DELETE:

- `test/unit/delete.test.ts` — AST factory: produces the
  expected `DeleteNode` shape, default flags, `.returning(...)`
  builds a fresh node preserving target/predicates/flags.
- `test/unit/delete-serialise.test.ts` — covers basic delete,
  AND chaining, identifier quoting, alias preservation,
  `RETURNING <columns>` and `RETURNING <expr> AS <alias>`,
  empty-predicates with the flag on, empty-predicates with the
  flag off (must throw).
- `test/unit/delete-types.test-d.ts` — type-level expectations:
  `Table.where(...).delete()` is `Delete<Columns, null>`;
  `.returning(...)` flips to `Delete<Columns, ProjectedShape<...>>`;
  `db.run(...)` resolves to `{ rowCount }` or rows; `.delete` is
  not exposed on a derived `Relation` (after `.order`) or a
  joined relation. Compile errors documented with
  `@ts-expect-error`.
- `test/integration/delete.test.ts` — end-to-end against a real
  test database: rowCount path, AND chaining, `.returning(...)`,
  `deleteAll()`, the empty-WHERE throw, alias preservation.

## What you'll trip over

A few traps from the v1.8 work that are likely to repeat:

- **Class identity in `instanceof`.** Importing `Delete` /
  `Insert` lazily can break `instanceof` if two copies of the
  class end up loaded. Always import from `src/query/...` paths
  with the `.js` extension; the bundler / tsc resolver gives
  one identity per real file.
- **Overload ordering.** Returning-bearing overloads first.
  Verify with a type-level test that `db.run(insert)` (no
  `.returning(...)`) resolves to `{ rowCount }` and
  `db.run(insert.returning(...))` resolves to rows.
- **Phantom field placement.** `declare readonly` phantoms live
  on the class, not on a `super` call or in the constructor.
  Inline declaration is what tsc looks at; runtime is happy
  either way (`declare` doesn't emit code).
- **Alias decisions.** Deciding whether to drop or preserve the
  target's alias is a per-statement choice. INSERT drops; DELETE
  preserves. Future statements should be reasoned about
  explicitly — the default should not be assumed.

## When to deviate

The recipe assumes a **statement-level** addition (a new
top-level node category). For finer-grained changes:

- A new comparator (`column.like(...)`, `column.ilike(...)`):
  add to the operators table in `src/sql/operators.ts`, add a
  `BinaryOperator` (or `UnaryOperator`) literal in the AST,
  expose a method on `Column`. No new fluent class, no new
  executor branch.
- A new relation operator (`relation.distinct()`, `groupBy(...)`):
  add a `RelationNode` variant, extend `collect` and the
  canonical-order emitter in `relationToSql`, add a method on
  `Relation`. No new executor branch.
- A schema-side change (a new column flag, e.g.
  `isPrimaryKey`): extend `ColumnType` (and the
  `columnType<...>` overload set if literal-preservation
  matters), thread through `tenon-generate` (`readCatalog` SQL
  - the emit), update the type files that consume the flag.

For anything bigger, write a plan file under `docs/plans/`
first. The v1.7 and v1.8 plans are the most recent examples.
