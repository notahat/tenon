# The AST

Every query tenon runs is first built as a tree of plain objects, the
abstract syntax tree. The fluent operators (`src/query/`) construct it,
and the serialiser (`src/sql/serialise.ts`) walks it to produce SQL.
This document is a reference for the node types themselves: what's in the
tree, and why it's shaped the way it is. [The query pipeline](pipeline.md)
shows the tree being built and serialised end to end; start there if you
want the narrative.

The nodes live in `src/ast/`, split into expressions
(`expression.ts`), relations (`relation.ts`), and one file per write
statement (`insert.ts`, `update.ts`, `delete.ts`).

## Nodes

A node is an immutable plain object with a `kind` discriminant and `readonly`
fields. Each node type comes with a small pure builder function that fills in
defaults, so construction sites never assemble the literal by hand:

```ts
export function where(source: RelationNode, predicate: ExpressionNode): Where {
  return { kind: "Where", source, predicate };
}
```

This keeps the AST a stable boundary. The fluent layer above it and the
serialiser below it both depend only on these shapes, not on each
other.

## Relation nodes

A relation is anything that produces rows: a table, or an operator
applied to a relation. The leaf is always a `TableRef`. Every operator
node carries a `source` field holding the relation it wraps, so a chain
nests outermost-operator-first down to the table:

```
users.where(...).limit(10)   ==   Limit -> Where -> TableRef
```

`RelationNode` is the union of all seven:

| Node | Fields beyond `kind` | Role |
| --- | --- | --- |
| `TableRef` | `schema`, `name`, `alias`, `foreignKeys` | The leaf: a base table |
| `Project` | `source`, `items` | The SELECT list |
| `Where` | `source`, `predicate` | A filter |
| `Order` | `source`, `terms` | ORDER BY, terms in order |
| `Limit` | `source`, `count` | LIMIT |
| `Offset` | `source`, `count` | OFFSET |
| `InnerJoin` | `source`, `right`, `on` | A join |

Three of these carry detail worth knowing:

- **`TableRef`** is the only node with no `source`. Its `alias` defaults
  to the table name and qualifies every column reference. Its
  `foreignKeys` array carries the table's outgoing foreign keys, copied
  from the schema at definition time. That array is what lets the
  serialiser infer a join's `ON` predicate later, without going back to
  the schema.
- **`InnerJoin`** is the only operator whose `right` side is constrained
  to a `TableRef` rather than an arbitrary `RelationNode`. Joining a
  sub-query isn't supported yet, and the type reflects that. Its `on`
  field is nullable: `null` means "infer the predicate from foreign
  keys at serialise time", and a non-null `ExpressionNode` is an
  explicit `.on(...)` predicate.
- **`Project` and `Order`** hold lists (`items`, `terms`) rather than a
  single value, and both preserve user order. A `ProjectionItem` pairs
  an expression with its `outputName`; an `OrderTerm` pairs one with a
  `direction`.

## Expression nodes

Expressions are the leaves of the value world: the things inside a
`Where` predicate, an `Order` term, or a `Project` item. `ExpressionNode`
is a union of five, and the set is kept deliberately small so the
serialiser stays simple:

| Node | Fields beyond `kind` | Role |
| --- | --- | --- |
| `ColumnRef` | `tableAlias`, `column` | A qualified column |
| `Parameter` | `value` | A bound value |
| `BinaryOp` | `operator`, `left`, `right` | `=`, `<`, `AND`, ... |
| `UnaryOp` | `operator`, `operand` | `NOT`, `IS NULL`, ... |
| `InList` | `operand`, `values` | `x IN (...)` |

The operator sets are themselves small closed unions:
`BinaryOperator` is the six comparisons plus `AND` and `OR`;
`UnaryOperator` is `NOT`, `IS NULL`, and `IS NOT NULL`. A new comparator
should be expressed by reusing `BinaryOp` or `UnaryOp` with an added
operator, rather than by adding a node kind.

`Parameter` is the one to understand. It carries only the runtime
`value`, never a placeholder number. The serialiser assigns `$1`, `$2`,
and so on left to right as it walks the tree, so any value a query
compares against rides through the AST as data and reaches Postgres as a
bound parameter. Tree transforms can move parameters around without
renumbering anything.

## Statement nodes

Inserts, updates, and deletes each get a top-level node that is a
**sibling** to `RelationNode`, not a member of it: `InsertNode`,
`UpdateNode`, `DeleteNode`. They aren't part of the relation union by
design. The SELECT serialiser, the join inference, and the
duplicate-column type brand all operate on `RelationNode`, and keeping
writes outside that union keeps all three focused on reads.

They share a common shape. Each targets a single `TableRef`, and each
has an optional `returning` field that reuses `ProjectionItem`, the same
type a SELECT projection uses. So `RETURNING` is typed and emitted by
the same machinery as a projection.

The differences are in what each one sets:

- **`InsertNode`** holds a `columnValues` list of `(column, value)`
  pairs in user-supplied order. Serialisation emits the column list and
  the `VALUES` list in that same order, so the keys line up with the
  placeholders.
- **`UpdateNode`** holds an `assignments` list (the `SET` clause) and a
  `predicates` list (AND-ed at emit time to form the `WHERE`).
- **`DeleteNode`** holds a `predicates` list and an
  `allowEmptyPredicates` flag. The flag is how an intentional
  "delete every row" is distinguished from a forgotten `WHERE`. Only
  `deleteAll()` sets it; a bare `delete()` produces an empty predicate
  list with the flag off, which the serialiser refuses to emit.

A note on the empty-list guards: the serialiser rejects an `UpdateNode`
with no assignments or no predicates, and a `DeleteNode` with no
predicates unless `allowEmptyPredicates` is set. The public fluent
surface can't construct those cases, so the guards are defensive against
code building nodes directly.

## Why this shape

The AST is the part of tenon designed to outlast the current feature
set. The node unions are closed and small, but every node was added so
that the unsupported SQL (outer joins, aggregates, sub-queries, set
operations) can be absorbed by adding node kinds, without changing the
ones already here. A `Where` will still be `{ kind, source, predicate }`
when there's a `GroupBy` sitting above it.

## Where to go next

- [The query pipeline](pipeline.md): the tree built and serialised
  end to end, with a worked example.
- [The serialiser](serialiser.md): how these nodes become SQL,
  including the foreign-key inference that fills in a join's `on`.
- [The type system](types.md): the phantom types that ride alongside
  these nodes and reject bad queries at compile time.
- [Adding an operator](adding-an-operator.md): adding a node kind and
  wiring it through, end to end.
