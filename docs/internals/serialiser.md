# The serialiser

The serialiser turns an AST tree into SQL. It lives in
`src/sql/serialise.ts` and is pure: a node goes in, a `{ text, params }`
record comes out, with no I/O and nothing mutated outside the call.
[The query pipeline](pipeline.md) traces one query through it; this
document goes deeper on the two-pass SELECT strategy, the foreign-key
inference, and how parameters are numbered.

There are four entry points, one per statement category:
`relationToSql` (SELECT), `insertToSql`, `updateToSql`, and
`deleteToSql`. Each builds a fresh `EmitContext`, emits the text, and
returns the accumulated parameters alongside it. They share the same
expression emitter and parameter numbering, so a value lands as `$1`,
`$2`, and so on the same way whatever the statement.

## Two passes for a SELECT

A relation tree nests outermost-operator-first, but SQL clauses have a
fixed order. `relationToSql` bridges that gap in two passes.

**First pass: `collect`.** Walk the tree from the outer node down to the
table, dropping each node's contribution into a mutable
`CollectedClauses` record. Most nodes recurse into their `source` after
recording themselves. The walk encodes two ordering rules:

- **Outer wins, for the single-valued clauses.** `Project`, `Order`,
  `Limit`, and `Offset` each set their slot only if it's still null.
  Because the walk starts from the outside, the outermost call is seen
  first and the slot is taken, so a later (inner) node of the same kind
  is ignored. This is why a second `.order(...)` replaces the first
  rather than appending: the outer one wins.
- **User order preserved, for the list clauses.** `Where` predicates and
  `InnerJoin`s are `unshift`ed onto their lists. The walk descends from
  outer to inner, but unshifting reverses that back, so the deepest
  (leftmost-written) node ends up first. `r.where(a).where(b)` emits
  `a AND b`; `a.innerJoin(b).innerJoin(c)` emits `a JOIN b JOIN c`.

**Second pass: `emitSelect`.** Take the collected clauses and write them
in canonical order: `SELECT` list, `FROM`, joins, `WHERE`, `ORDER BY`,
`LIMIT`, `OFFSET`. A tree with no `TableRef` at the bottom throws here,
which can't happen from the fluent surface but guards direct
construction.

A few emission details:

- **The SELECT list drops a redundant `AS`.** A projection item emits as
  `<expr> AS "<name>"`, except when the expression is a bare `ColumnRef`
  whose column already matches the output name, where the `AS` is
  omitted. With no projection at all, the list is `*`.
- **Identifiers are always quoted.** `quoteIdent` wraps every table,
  column, and alias in double quotes and doubles any embedded quote.
  Postgres treats a quoted lowercase identifier as equal to the unquoted
  form, so unconditional quoting is safe and sidesteps every
  reserved-word question.
- **A `TableRef`'s alias is emitted only when it differs** from the
  physical name. `users` emits bare; `users.as("u")` emits
  `"public"."users" AS "u"`.

## Inferring a join's ON

When `collect` reaches an `InnerJoin` whose `on` is null, it calls
`inferJoinPredicate` to build the predicate from foreign-key metadata.
This is the heart of why `posts.innerJoin(users)` needs no `ON`.

The inference works over the `TableRef`s on each side:

1. `collectTableRefs` gathers every `TableRef` in the join's `source`
   subtree. The right side is always a single `TableRef`.
2. For each source table, `fkMatchesPointing` looks for a single-column
   foreign key connecting it to the right table, **in both directions**:
   a key on the source pointing at the right, and a key on the right
   pointing at the source. Each match records the two aliases and
   columns to compare.
3. With exactly one match, the predicate is
   `<leftAlias>.<leftColumn> = <rightAlias>.<rightColumn>`, built as a
   `BinaryOp`.

Three cases make inference throw:

- **No match.** No foreign key connects the sides, so there's nothing to
  infer. The error points you at `.on(...)`.
- **More than one match.** Two or more foreign keys could connect the
  sides, so the join is ambiguous.
- **A self-join.** When a source table and the right table are the same
  physical table (`samePhysicalTable`), inference is skipped for that
  pair and a self-join error is raised, again pointing at `.on(...)`.

Composite (multi-column) foreign keys are skipped entirely: the
`fk.columns.length !== 1` check passes over them, so they never
contribute a match. Inferring across them isn't supported yet.

These runtime throws are a backstop. The same three cases (missing,
ambiguous, self-join) are also caught by the type system as brands that
surface at the `db.run(...)` call, so in typed code you see the error at
compile time and the throw never fires. See
[the type system](types.md).

## Parameters

Values never reach the SQL text. A `Parameter` node carries its value,
and `emitExpression` handles it by pushing the value onto
`context.params` and emitting `$N` where `N` is the new array length:

```ts
case "Parameter":
  context.params.push(node.value);
  return `$${context.params.length}`;
```

Because the walk is left-to-right and every entry point threads one
`EmitContext` through the whole emit, placeholder numbers always line up
with the array, across joins, `WHERE`, and `RETURNING` alike. Nothing
ever renumbers. A value reaches Postgres as a bound parameter, so there
is no SQL-injection surface.

## Emitting expressions

`emitExpression` is a recursive switch over the five expression kinds.
`ColumnRef` emits a qualified, quoted pair; `Parameter` is the case
above; `BinaryOp`, `UnaryOp`, and `InList` recurse into their operands
and wrap the result in parentheses. The parentheses are unconditional,
which sidesteps operator-precedence reasoning at the cost of some
redundant brackets.

The operator spellings live in `src/sql/operators.ts`, not in the
serialiser. `binarySql` maps each `BinaryOperator` to its SQL text, and
`unaryFix` gives each `UnaryOperator` a prefix/suffix pair (so `NOT`
prefixes its operand while `IS NULL` suffixes it). Keeping them in their
own module means adding an operator spelling is one edit there, separate
from the emission logic.

## Write statements

The three write emitters share the expression machinery but differ in
shape, and in one telling detail: whether they keep the target's alias.

- **`emitInsert`** drops the target alias. An INSERT names one table and
  doesn't qualify columns, so an alias would only clutter the SQL. With
  an empty column-values list it emits `DEFAULT VALUES`; otherwise the
  column list and `VALUES` list emit in the same user-supplied order, so
  keys line up with placeholders.
- **`emitUpdate`** and **`emitDelete`** keep the target alias. Their
  predicates qualify columns by that alias, so dropping it would produce
  broken SQL after a `Table.as(...)`. `emitUpdate` writes
  `SET <assignments> WHERE <predicates>`; `emitDelete` writes an
  optional `WHERE`.

All three reuse `emitSelectList` for an optional `RETURNING` tail, so a
returned row is shaped and emitted exactly like a projection.

The write emitters also hold the safety guards. `emitUpdate` throws on an
empty assignment list or empty predicate list. `emitDelete` throws on an
empty predicate list unless `allowEmptyPredicates` is set, which only
`deleteAll()` does. These mirror what [the AST](ast.md) records on the
nodes, and they fire before any SQL leaves the process.

## Where to go next

- [The query pipeline](pipeline.md): the serialiser in the context of a
  full query, build to rows.
- [The AST](ast.md): the node types this walks, including the
  `allowEmptyPredicates` flag and the FK metadata on a `TableRef`.
- [The type system](types.md): how the missing / ambiguous / self-join
  join errors are caught at compile time, before these throws.
- [Adding an operator](adding-an-operator.md): adding a node and its
  emission, end to end.
