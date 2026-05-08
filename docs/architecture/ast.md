# AST

The data layer. Plain TypeScript shapes for relations,
expressions, inserts, and deletes; pure factory functions to
build them.

Everything in `src/ast/` is data. No methods, no classes, no
imports outside of `src/ast/`.

## Statement categories

There are **three** top-level statement types, not one:

- `RelationNode` (`src/ast/relation.ts`) — SELECT trees.
- `InsertNode` (`src/ast/insert.ts`) — INSERT statements.
- `DeleteNode` (`src/ast/delete.ts`) — DELETE statements.

`InsertNode` and `DeleteNode` are **siblings** of `RelationNode`,
not variants. The motivation:

- The SELECT serialiser walks `RelationNode` exhaustively. Adding
  Insert/Delete as `RelationNode` variants would force every
  switch in `relationToSql` to handle "this isn't actually a
  relation" cases.
- The duplicate-column brand on joins lives on a relation's
  columns shape. Inserts and deletes don't have a columns-shape
  brand.
- The fluent split mirrors the AST split: `Relation`, `Insert`,
  and `Delete` are different classes, dispatched on by
  `Database.run` via `instanceof`.

Each AST file exports one factory function per node kind, all
pure.

## `RelationNode`

```ts
type RelationNode =
  | TableRef
  | Project
  | Where
  | Order
  | Limit
  | Offset
  | InnerJoin;
```

Each variant carries a `kind` discriminator and a `source` field
(except `TableRef`, which is the leaf). The chain
`users.where(p).limit(10)` becomes:

```
Limit { source: Where { source: TableRef }, count: 10 }
```

A `TableRef` always carries a schema, name, an alias (which
defaults to `null` and is treated as "use the name"), and a
`foreignKeys` array. Aliases let `defineTable(...).as("u")`
produce a fresh table whose columns are qualified by `"u"`
rather than the physical name. The FK list is what the
serialiser reads when filling in an `InnerJoin`'s ON predicate
from foreign-key metadata.

`InnerJoin` restricts the right side to a `TableRef` — joining
sub-queries is not yet supported. The fluent layer
(`Relation.innerJoin`) enforces this with a runtime check. Its
`on` field is `ExpressionNode | null`; a null means "infer the
predicate at serialise time from the FK metadata on the source
and right TableRefs". Calling `.on(predicate)` on the fluent
JoinBuilder rebuilds the AST with the explicit predicate baked
in.

## `ExpressionNode`

```ts
type ExpressionNode = ColumnRef | Parameter | BinaryOp | UnaryOp | InList;
```

Comparisons, logical operators, NULL checks, and `IN (...)` are
all encoded with these five shapes. New operator forms should
reuse `BinaryOp` / `UnaryOp` wherever possible — adding a new
node type is reserved for things those don't model
(e.g. `InList` had to be its own node because of the
variable-length value list).

`Parameter` carries a runtime value but **not** a placeholder
index. The serialiser assigns `$1`, `$2`, ... left-to-right at
emit time, so AST transforms never need to renumber. (See
[serialiser.md](serialiser.md).)

## `InsertNode`

```ts
interface InsertNode {
  kind: "Insert";
  target: TableRef;
  columnValues: ReadonlyArray<{ column: string; value: ExpressionNode }>;
  returning: ReadonlyArray<ProjectionItem> | null;
}
```

`columnValues` preserves user-supplied order — emission writes
the column list and the VALUES list in the same order, so keys
match placeholders. Today every value is a `Parameter`; the type
allows arbitrary expressions to make `INSERT INTO t (col) VALUES
(other_col + 1)` cheap to add later.

`returning` reuses `ProjectionItem` from the relation AST so the
RETURNING list and the SELECT-list emit through the same code
path.

## `DeleteNode`

```ts
interface DeleteNode {
  kind: "Delete";
  target: TableRef;
  predicates: ReadonlyArray<ExpressionNode>;
  allowEmptyPredicates: boolean;
  returning: ReadonlyArray<ProjectionItem> | null;
}
```

Two notable shape choices:

- **Predicates are stored as a flat array**, not as a nested
  `Where(Where(...))` chain. They AND together at emit time. The
  flat shape makes the empty-predicate guard trivial
  (`predicates.length === 0`); a nested form would require a
  walk.
- **`allowEmptyPredicates` is on the AST node**, not on the
  fluent class. The serialiser refuses to emit a node with no
  predicates and the flag off. That makes the guard fail closed:
  every code path that reaches SQL is checked, including any
  future internal AST construction (e.g. tooling building a
  `DeleteNode` directly).

## What's not in the AST

- No statement-level metadata (statement IDs, locations, debug
  info). The AST is "what to emit", nothing more.
- No SQL. Strings of SQL only show up in the serialiser; the AST
  knows nothing about identifier quoting, parameter syntax, or
  reserved words.
- No mutation. Every factory builds a fresh object; consumers
  treat AST nodes as immutable.
