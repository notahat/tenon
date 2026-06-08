# Adding an operator

This is the practical capstone for the internals track. The other docs
explain the layers; this one walks one new operator through all of them,
in the order you'd actually build it. If you've read [the query
pipeline](pipeline.md), you've seen these layers once already. Here we
add to them.

The worked example is `distinct()`, which would emit `SELECT DISTINCT`.
It's a good teaching case because it touches every layer but changes
nothing about the row shape, so the type machinery mostly gets out of
the way. The last section covers what's different when an operator does
change the shape.

The operator doesn't exist in the codebase; treat the code below as the
recipe, not a citation.

## The shape of the work

A read operator lives in four places, built bottom-up:

1. **The AST** (`src/ast/relation.ts`): a node type and its builder.
2. **The serialiser** (`src/sql/serialise.ts`): collecting the node and
   emitting its SQL.
3. **The fluent layer** (`src/query/Relation.ts`): the method you call.
4. **The tests**: unit tests for the node and the SQL, an integration
   test for the round trip.

## 1. The AST node

Add the interface, add it to the `RelationNode` union, and write a pure
builder. A `distinct` is just a wrapper around its source:

```ts
/** A SELECT DISTINCT marker. */
export interface Distinct {
  readonly kind: "Distinct";
  readonly source: RelationNode;
}

export type RelationNode =
  | TableRef
  | Project
  // ...the rest...
  | Distinct;

/** Build a Distinct node. Pure. */
export function distinct(source: RelationNode): Distinct {
  return { kind: "Distinct", source };
}
```

Follow the conventions already there: `readonly` fields, a `kind`
discriminant, a one-line builder with a header comment. See
[the AST](ast.md) for why the nodes look like this.

## 2. The serialiser

Two passes need to know about the new kind, and TypeScript's exhaustive
`switch` over `node.kind` will fail to compile until you handle it, which
is the reminder you want.

**`collect`.** Add a case that records the operator's contribution and
recurses into `source`. `distinct` is a single on/off marker, so it
follows the outer-wins rule the same way `Limit` does: add a
`distinct: boolean` field to `CollectedClauses` and set it. (An operator
that accumulates, like `Where`, would `unshift` onto a list instead. See
[the serialiser](serialiser.md) for why those two rules exist.)

```ts
case "Distinct":
  clauses.distinct = true;
  collect(node.source, clauses);
  return;
```

**`collectTableRefs`.** This helper walks a subtree gathering tables for
join inference. Any node with a `source` has to recurse, so add
`"Distinct"` alongside the other pass-through cases.

**`emitSelect`.** Emit the keyword in canonical position. For `DISTINCT`
that's right after `SELECT`:

```ts
const keyword = clauses.distinct ? "DISTINCT " : "";
const parts: string[] = [
  `SELECT ${keyword}${selectList} FROM ${emitTableRef(clauses.table)}`,
];
```

An operator that emits its own clause (a `GROUP BY`, say) would add a
`parts.push(...)` in the right spot instead.

## 3. The fluent layer

Add the method to `Relation`. Because `distinct` doesn't change the row
shape, it returns `Relation<Columns, FKs>` unchanged, the same as
`where` and `limit`:

```ts
/** Emit SELECT DISTINCT for this relation. */
distinct(): Relation<Columns, FKs> {
  return new Relation<Columns, FKs>(distinctNode(this.node));
}
```

Import the builder (aliased to `distinctNode`, the file's convention for
distinguishing the node builder from the method). That's the whole
runtime path: the method wraps a node, and serialisation already knows
what to do with it.

## 4. Tests

Match the existing split:

- **`test/unit/ast.test.ts`**: the builder returns the right node.
- **`test/unit/emit.test.ts`** (or a focused serialise test): the node
  emits the expected SQL string and parameters. This is where most of
  the value is, since serialisation is pure and easy to pin down.
- **`test/integration/executor.test.ts`**: a real query through a real
  Postgres, asserting the rows. Integration tests run against the
  `tenon_test` database:

  ```sh
  DATABASE_URL=postgres://localhost/tenon_test npm run test:integration
  ```

The unit and type tests run together with `npm test`.

## When the operator changes the shape

`distinct` is shape-preserving, so its generics pass straight through.
An operator that changes the row shape has a fifth piece of work, in the
type system, and `project` is the model to copy.

`project` returns `Relation<ProjectedShape<Items>, FKs>`, not
`Relation<Columns, FKs>`. `ProjectedShape` is a type-level function that
computes the new `ColumnsShape` from the projected items. So a
shape-changing operator means: write the type-level transform alongside
the runtime method, thread it through the method's return type, and add
a `.test-d.ts` type test asserting the resulting row type. [The type
system](types.md) covers how those shape types are built, and how a
brand would ride along if the operator could be misused in a way worth
catching at `db.run`.

The same pattern extends to the write statements, which have their own
nodes (`InsertNode`, `UpdateNode`, `DeleteNode`), their own serialiser
entry points, and their own fluent wrappers in `src/query/`. The layers
are the same; only the files differ.

## Where to go next

- [The AST](ast.md): the node conventions step 1 follows.
- [The serialiser](serialiser.md): the two-pass strategy and ordering
  rules step 2 plugs into.
- [The type system](types.md): the shape transforms and brands a
  shape-changing operator needs.
