# Fluent layer

The user-facing classes that build AST nodes:
`Relation`, `Insert`, `Update`, `Delete`, `WritableScope`,
`SingleRow`, `WritableSingleRow`, `SingleRowOrThrow`, plus the
expression-side `Column`, `AliasedColumn`, `Expression`,
`Ordering`, and `JoinBuilder`.

All in `src/query/`. Each class wraps an AST node, exposes
methods that produce more AST, and carries phantom types that
thread compile-time information forward.

## Why classes

`Relation`, `Insert`, `Update`, `Delete`, `SingleRow`, and
`SingleRowOrThrow` are classes (not plain discriminated unions
of POJOs) for one reason: `Database.run` dispatches by
`instanceof`. The runtime needs to ask "is this an Insert?" /
"is this an Update?" / "is this a Delete?" / "is this a
SingleRow?" without reading a
`kind` field that may not match what the type system thinks (the
user's generated columns shape isn't in the runtime data).
`instanceof` is the cheapest, most explicit answer.

`Column`, `Expression`, `Ordering`, `AliasedColumn`, `JoinBuilder`
are also classes, but for a different reason: they need to carry
methods (`.eq`, `.and`, `.on`). They're conceptually values
either way; the class wrapping is structural.

## Phantom types

Several classes carry `declare readonly _xxx` fields:

```ts
class Relation<Columns, FKs = readonly []> {
  declare readonly _columns: Columns;
  declare readonly _foreignKeys: FKs;
  // ...
}

class Insert<Columns, Returning> {
  declare readonly _columns: Columns;
  declare readonly _returning: Returning;
  // ...
}

class Update<Columns, Returning> {
  declare readonly _columns: Columns;
  declare readonly _returning: Returning;
  // ...
}

class Delete<Columns, Returning> {
  declare readonly _columns: Columns;
  declare readonly _returning: Returning;
  // ...
}

class SingleRow<Columns> {
  declare readonly _kind: "SingleRow";
  declare readonly _columns: Columns;
  // ...
}

class SingleRowOrThrow<Columns> {
  declare readonly _kind: "SingleRowOrThrow";
  declare readonly _columns: Columns;
  // ...
}

class JoinBuilder<L, LFKs, LSchema, LName, R, RFKs, RSchema, RName>
  extends Relation<MergedColumnsWithFkBrand<...>, MergedForeignKeys<LFKs, RFKs>>
{
  declare readonly _left: L;
  declare readonly _leftFks: LFKs;
  declare readonly _leftSchema: LSchema;
  declare readonly _leftPhysicalName: LName;
  declare readonly _right: R;
  declare readonly _rightFks: RFKs;
  declare readonly _rightSchema: RSchema;
  declare readonly _rightPhysicalName: RName;
  // ...
}
```

`JoinBuilder` extends `Relation` so a JoinBuilder is itself
runnable — the serialiser fills in the ON predicate from FK
metadata when no `.on(...)` was supplied. The two classes live
together in `Relation.ts`; `JoinBuilder.ts` is a one-line
re-export so import paths stay natural.

The viable alternatives all cost more than co-location:

- **Separate files.** Either an ESM circular import (which fails
  at the `extends Relation` evaluation when JoinBuilder.ts loads
  before Relation finishes initialising), or a module-init
  factory-registration hook — replacing a structural guarantee
  with a runtime invariant.
- **Type alias instead of a subclass.** A `Relation<branded> & {
  on }` alias structurally type-checks but quietly drops the
  FK-inference brand at `db.run(...)` time; the brand only
  surfaces correctly when JoinBuilder is a class instantiation.
- **Split `Relation` into a `BaseRelation` + overlay.** Breaks
  chained joins (`a.innerJoin(b).innerJoin(c)`), which need each
  step's result to carry `innerJoin` itself.

`declare` means TypeScript believes the field exists; at runtime
it doesn't. Phantoms are **type-system carriers**: a way to make
two structurally identical runtime objects distinct in the type
system, or to thread a generic parameter that has no runtime
representation.

Three uses:

- **Discriminating classes the runtime can't tell apart by
  shape.** `Insert<C, null>` and `Insert<C, R>` have the same
  runtime fields; `_returning` exists only to thread the
  difference into `Database.run`'s overload resolution.
- **Threading a generic forward.** `Relation<Columns>` doesn't
  store `Columns` at runtime — it's just an AST node — but
  operators need to compute new `Relation` types from it.
- **Cross-class discrimination when AST nodes overlap.**
  `SingleRow<C>` and `Relation<C>` both wrap a `RelationNode`,
  so they're structurally identical from TypeScript's point of
  view. The `_kind: "SingleRow"` / `_kind: "SingleRowOrThrow"`
  phantoms keep `Database.run`'s SingleRow overloads from also
  matching a plain Relation. `Insert`, `Update`, and `Delete`
  don't need
  this trick — each wraps its own AST node type
  (`InsertNode` vs `UpdateNode` vs `DeleteNode`), so the
  structural difference is real already.

The phantoms are documented inline in each class with `// Phantom:`
comments.

## Class roster

### `Relation<Columns>`

Wraps `RelationNode`. Operators (`where`, `order`, `limit`,
`offset`, `project`, `innerJoin`) build a new `Relation` by
wrapping the current node in another AST node. Nothing mutates.

`Relation.innerJoin(other)` returns a `JoinBuilder` rather than a
new `Relation` directly — the join isn't complete until `.on`
supplies the predicate. This makes "forgot the ON clause" a
compile error rather than a Cartesian product.

### `JoinBuilder<Left, Right>`

Two-step builder. `.on(predicate)` returns a
`Relation<MergedColumns<Left, Right>>`. The merged columns shape
carries the duplicate-column brand if the two sides share any
column names. (See [types-and-phantoms.md](types-and-phantoms.md).)

### `Column<TableName, Name, Type>`

Wraps a `ColumnRef` AST node. Comparison methods (`eq`, `neq`,
`lt`, `lte`, `gt`, `gte`, `isNull`, `isNotNull`, `in`) build
`Expression<boolean>` values. `.asc()` / `.desc()` build
`Ordering` values. `.as(name)` builds an `AliasedColumn`.

The three phantoms (`_tableName`, `_columnName`, `_type`) thread
through projection inference (`ProjectedShape`) and comparator
type-checking (`ComparableTo`).

### `Expression<TsResult>`

Wraps an arbitrary `ExpressionNode`. Carries `.and`, `.or`, `.not`
combinators (constrained via `this: Expression<boolean>` so
they're only available on boolean expressions).

### `AliasedColumn<OutputName, Type>`

Produced only by `column.as("name")`. Has no methods; the
wrapping exists to carry the literal output-name into projection
inference.

### `Ordering`

Wraps an `OrderTerm`. Produced by `column.asc()` / `column.desc()`.
Has no methods. The wrapping makes `Relation.order` reject bare
columns or expressions, which would otherwise be silently
dropped.

### `Insert<Columns, Returning>`

Wraps an `InsertNode`. `.returning(...)` produces a fresh
`Insert` with the projection set; the `Returning` generic flips
from `null` to a `ColumnsShape` so `Database.run` resolves to
typed rows.

### `Update<Columns, Returning>`

Wraps an `UpdateNode`. Same `.returning(...)` story as `Insert`.
Built by `WritableScope.update(attrs)` and
`WritableSingleRow.update(attrs)` — there is no `.update` on
`Table` itself.

### `Delete<Columns, Returning>`

Wraps a `DeleteNode`. Same `.returning(...)` story as `Insert`.

### `WritableScope<Alias, Columns> extends Relation<Columns>`

A `Relation` plus `.delete()`, `.update(attrs)`, and a `.where`
override that returns `WritableScope` (so the scope stays alive
across chained `.where` calls). Other inherited operators
(`.order`, `.limit`, `.project`, `.innerJoin`) widen back to plain
`Relation` and drop both write methods — which is correct: UPDATE
and DELETE have no ORDER/LIMIT/PROJECT/JOIN in this iteration.

`.delete()` and `.update(attrs)` both walk the wrapped Where-chain
back to the root `TableRef` and pull out the predicate list. The
walk is local to the scope; nothing else in the codebase needs it.
`.update` additionally flattens the attrs object into an ordered
list of `UpdateAssignment`s so the SET clause is deterministic.

### `SingleRow<Columns>`, `WritableSingleRow<Columns>`, and `SingleRowOrThrow<Columns>`

Wrap a `RelationNode` that the type system promises will resolve
to 0 or 1 rows. Built by `Table.find(id)`, which is conditionally
available on tables with a single-column primary key
(composite or absent PKs omit the method entirely via a
type-level `Record<never, never>`). The underlying AST is a
`Where(TableRef, pk = $1)` wrapped in `Limit(1)`.

`Table.find(id)` actually returns a `WritableSingleRow` — a
`SingleRow` subclass that adds `.delete()` and `.update(attrs)`.
The subclass captures the target `TableRef` and the primary-key
predicate explicitly, so the write methods can build a
`DeleteNode`/`UpdateNode` without walking the wrapped node (the
wrapped node has a `Limit` between the `Where` and the
`TableRef`, which the `WritableScope` predicate-walker doesn't
handle). The wrapped `LIMIT 1` is intentionally dropped at
write-time: Postgres has no `DELETE/UPDATE ... LIMIT`, and the
primary-key predicate already restricts the statement to ≤1 row.

This split mirrors `Relation` / `WritableScope`: read-side and
mutation-side capabilities live on different classes so the type
system can withhold `.delete()` and `.update()` from values where
they would be unsound. Belongs-to accessors wired by `defineSchema`
(next section) construct plain `SingleRow`, not
`WritableSingleRow`, because their wrapped node is an inner-join
relation rather than a flat `WHERE pk = ?` — turning that into a
`DELETE`/`UPDATE` would need `... USING` or a CTE, which is out
of scope.

`SingleRow.orThrow()` returns a `SingleRowOrThrow` over the same
underlying node. The two classes differ only in how
`Database.run` interprets the result: `SingleRow` resolves to
`RowOf<C> | null`, `SingleRowOrThrow` to `RowOf<C>` (rejecting
with `RowNotFoundError` when the SQL returns zero rows).
`WritableSingleRow` is a `SingleRow` subclass, so it matches the
same `Database.run` overload — no separate dispatch branch. All
three classes are exported from `src/query/SingleRow.ts`.

Neither `SingleRow` nor `SingleRowOrThrow` has operator methods
of its own; only `WritableSingleRow` adds `.delete()` and
`.update(attrs)`. The
association accessors (`posts.find(1).comments`,
`comments.find(5).post`) are merged onto the SingleRow at runtime
by `defineSchema` — see the next section. Bare SingleRows (built
without going through defineSchema) carry no accessors but are
still runnable.

## Schema-wide wiring: `defineSchema`

`defineSchema` lives in `src/schema-runtime/defineSchema.ts`. It
takes a record of Tables, mutates each one's `find` method in
place, and returns the same record re-typed as `WiredSchema<S>`
so the new `find` return type is visible.

```ts
const { users, posts } = defineSchema({
  users: defineTable("public", "users", { ... }, [...], { columns: ["id"] }),
  posts: defineTable("public", "posts", { ... }, [...], { columns: ["id"] }),
});
```

Each replacement `find(id)` calls the original to build the bare
SingleRow, then `Object.assign`s two accessor records onto it:

- **Has-many accessors.** Walk every other table in the schema;
  for each whose FK list points back at this table, add an
  accessor named after the child's physical name. The accessor
  is a `Relation<ChildColumns>` whose underlying SQL is
  `SELECT child.* FROM child WHERE child.fkColumn = $parentId`
  — no join needed because the parent id is captured in the
  `find` call.
- **Belongs-to accessors.** Walk this table's outgoing FKs; for
  each whose target is in the schema, add an accessor named by
  stripping `_id` from the FK column (or the referenced table
  name if there's no `_id` suffix). The accessor is a
  `SingleRow<ParentColumns>` whose SQL is
  `SELECT parent.* FROM parent JOIN this ON ... WHERE this.pk = $childId LIMIT 1`.

Skip rules at runtime mirror the type-level transform in
`src/query/types.ts`: self-references (would collide with the
table's own physical name on the has-many side), accessor names
that shadow a column on the source table, missing belongs-to
targets. Ambiguous has-many (two FKs from the same child to the
same parent) is skipped at runtime; the type-level
`AmbiguousHasManyBrand` keeps the call from running.

The mutation is the one exception to the "fluent layer never
mutates" rule. See [`overview.md`](overview.md) for the rationale
(referential identity matters for hand-written schemas).

Belongs-to accessors return a plain `SingleRow`, not a
`WiredSingleRow`, in v1. Chained walks like
`comments.find(5).post.author` would need each accessor to extend
an existing join chain rather than start a new query — left to a
v1.12 follow-up. See `docs/plans/v1.11-fk-accessors.md` for the
scope decision.

## What's not in the fluent layer

- SQL strings. Fluent methods build AST; serialisation is
  somebody else's job.
- I/O. Fluent classes never touch the network, the filesystem,
  the clock, or `process.env`.
- State that survives between operator calls. Each call returns
  a fresh value; nothing mutates.
