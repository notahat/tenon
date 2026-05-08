# Fluent layer

The user-facing classes that build AST nodes:
`Relation`, `Insert`, `Delete`, `DeletableScope`, plus the
expression-side `Column`, `AliasedColumn`, `Expression`,
`Ordering`, and `JoinBuilder`.

All in `src/query/`. Each class wraps an AST node, exposes
methods that produce more AST, and carries phantom types that
thread compile-time information forward.

## Why classes

`Relation`, `Insert`, and `Delete` are classes (not plain
discriminated unions of POJOs) for one reason: `Database.run`
dispatches by `instanceof`. The runtime needs to ask "is this an
Insert?" / "is this a Delete?" without reading a `kind` field
that may not match what the type system thinks (the user's
generated columns shape isn't in the runtime data). `instanceof`
is the cheapest, most explicit answer.

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

class Delete<Columns, Returning> {
  declare readonly _columns: Columns;
  declare readonly _returning: Returning;
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

Two uses:

- **Discriminating classes the runtime can't tell apart by
  shape.** `Insert<C, null>` and `Insert<C, R>` have the same
  runtime fields; `_returning` exists only to thread the
  difference into `Database.run`'s overload resolution.
- **Threading a generic forward.** `Relation<Columns>` doesn't
  store `Columns` at runtime — it's just an AST node — but
  operators need to compute new `Relation` types from it.

`Insert` and `Delete` don't need a cross-class discriminator: each
already wraps its own AST node type (`InsertNode` vs `DeleteNode`),
so the structural difference is real, not just a phantom.

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

### `Delete<Columns, Returning>`

Wraps a `DeleteNode`. Same `.returning(...)` story as `Insert`.

### `DeletableScope<Alias, Columns> extends Relation<Columns>`

A `Relation` plus `.delete()` and a `.where` override that
returns `DeletableScope` (so the scope stays alive across chained
`.where` calls). Other inherited operators (`.order`, `.limit`,
`.project`, `.innerJoin`) widen back to plain `Relation` and lose
`.delete` — which is correct: DELETE has no ORDER/LIMIT/PROJECT/JOIN
in this iteration.

`.delete()` walks the wrapped Where-chain back to the root
`TableRef` and pulls out the predicate list. The walk is local to
the scope; nothing else in the codebase needs it.

## What's not in the fluent layer

- SQL strings. Fluent methods build AST; serialisation is
  somebody else's job.
- I/O. Fluent classes never touch the network, the filesystem,
  the clock, or `process.env`.
- State that survives between operator calls. Each call returns
  a fresh value; nothing mutates.
