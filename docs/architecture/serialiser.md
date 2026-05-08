# Serialiser

`src/sql/serialise.ts` — pure functions that turn AST nodes into
parameterised SQL.

Three top-level entry points, one per statement category:

```ts
relationToSql(node: RelationNode): CompiledQuery;  // SELECT
insertToSql(node: InsertNode): CompiledQuery;      // INSERT
deleteToSql(node: DeleteNode): CompiledQuery;      // DELETE

interface CompiledQuery {
  text: string;
  params: ReadonlyArray<unknown>;
}
```

`text` is a parameterised SQL string using `$1`, `$2`, ... `pg`
placeholders. `params` is the values in the order the placeholders
appear.

## `EmitContext` and parameter numbering

Every emit walk threads a single `EmitContext`:

```ts
interface EmitContext {
  readonly params: unknown[];
}
```

The single mutable accumulator is contained to one top-level
call, so the public `relationToSql` / `insertToSql` /
`deleteToSql` are externally pure.

`Parameter` AST nodes carry a runtime value but **not** a
placeholder index. The serialiser assigns the index when it
emits the parameter:

```ts
case "Parameter":
  context.params.push(node.value);
  return `$${context.params.length}`;
```

This means parameters are numbered left-to-right at emit time,
in the order they appear in the output SQL. AST transforms never
need to renumber anything: cut a subtree, insert another,
re-emit, and the numbering re-derives from scratch.

The same `EmitContext` flows through whichever entry point is
active. So an `INSERT INTO t (col) VALUES ($1) RETURNING $2 AS
calc` (hypothetical) would have `$1` for the value and `$2` for
the returning expression in the order they appear in the text —
exactly what `pg` expects.

## SELECT: `relationToSql` / `emitSelect`

The relation tree is walked **once** to gather clauses, then
emitted in canonical SQL order.

```
collect: TableRef + joins + projection + predicates + order + limit + offset
emit:    SELECT <projection>
         FROM <table> [AS <alias>]
         [INNER JOIN <table> ON <expr> ...]
         [WHERE <pred1> AND <pred2> ...]
         [ORDER BY <terms>]
         [LIMIT n]
         [OFFSET n]
```

`collect` walks the source chain and unshifts `Where` and
`InnerJoin` predicates so that the user's chaining order
matches the emitted SQL order: `r.where(a).where(b)` emits
`WHERE a AND b`, not `WHERE b AND a`. For `Project`, `Order`,
`Limit`, and `Offset`, **outer wins** — the outermost wrapping
overrides any inner one. The fluent API exposes only the
outer-wins behaviour by always wrapping; inner wins would
require dipping below the fluent layer.

`emitSelect` throws if the tree has no `TableRef`. By
construction, every fluent-built relation has one — only direct
AST construction could produce an unrooted tree, and that's a
programmer error.

## INSERT: `insertToSql` / `emitInsert`

Straightforward shape:

```
INSERT INTO "schema"."name" (col1, col2) VALUES ($1, $2) [RETURNING ...]
```

The target's alias is **dropped**. INSERT doesn't need to qualify
the target, and aliasing it would only complicate the SQL
without changing semantics.

If the column-values list is empty, the emitter writes
`INSERT INTO ... DEFAULT VALUES`. That's only valid when every
column has a default; Postgres surfaces the right error
otherwise.

## DELETE: `deleteToSql` / `emitDelete`

```
DELETE FROM "schema"."name" [AS "alias"] [WHERE ...] [RETURNING ...]
```

Two notable differences from INSERT:

- **Alias is preserved.** Predicates qualify columns by the same
  alias, so dropping it would produce broken SQL when the user
  calls `Table.as(...)` before deleting.
- **Empty-WHERE guard.** If `predicates.length === 0` and
  `allowEmptyPredicates === false`, `emitDelete` throws:

  ```
  DELETE without a WHERE clause is forbidden.
  Call Table.deleteAll() if you really mean to wipe every row.
  ```

  The guard lives in the serialiser, not the fluent layer, so
  every code path that reaches SQL is checked. The flag is on
  the AST node; only `Table.deleteAll()` sets it on.

Predicates are AND-ed in array order. The flat predicate list
(rather than a nested `Where(Where(...))` chain) makes both the
emit and the guard one-liners.

## Identifier quoting

`emitExpression`, `emitTableRef`, `emitInsertColumns`, and
friends all run identifiers through `quoteIdent` from
`src/sql/identifier.ts`. The function double-quotes every
identifier, escapes any internal `"` characters, and is the only
path identifiers take to the output. There is no "this name
doesn't need quoting" fast path; correctness wins over cosmetic
SQL.

## Operator emission

Comparison and logical operators have a small lookup table in
`src/sql/operators.ts` (`binarySql`, `unaryPrefixSql`,
`unarySuffixSql`). `emitExpression` dispatches on the AST
operator name and inserts the SQL token. Adding a new operator
form usually means: add a new `BinaryOperator` / `UnaryOperator`
literal, extend the lookup, expose a comparator method on
`Column`. See [adding an operator](adding-an-operator.md) for
the walkthrough.

## What the serialiser doesn't do

- **No schema validation.** It trusts that the AST it receives
  came from the fluent layer (or a tool that knows what it's
  doing). Bad SQL is Postgres's problem.
- **No SQL formatting beyond clause ordering.** Expressions are
  parenthesised aggressively; the result is correct but not
  pretty-printed.
- **No statement caching.** `relationToSql(node)` and
  `relationToSql(equalNode)` both walk the tree from scratch.
