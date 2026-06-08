# The type system

Alongside the runtime tree, every query carries a second structure that
exists only in the type checker. It tracks what columns a relation has
and what they hold, computes the result type of `db.run(...)`, and
rejects bad queries before they run. None of it survives compilation;
it leaves no runtime trace. [The query pipeline](pipeline.md) shows it
running in parallel with the tree. This document is how it works.

Most of the machinery lives in `src/query/types.ts`. The per-column
carrier it builds on, `ColumnType`, lives in
`src/schema-runtime/columnType.ts`.

## The phantom carrier

Everything starts from one type, `ColumnType`, which records five things
about a column:

```ts
ColumnType<TsType, SqlTag, Nullable, HasDefault, IsGenerated>
```

`TsType` (the type you read the column as) and `SqlTag` (its Postgres
type name) are **phantom**: they appear only in the type parameters and
are never stored. The three flags are real values at runtime as well, so
both the type checker and the executor can read them. A `ColumnsShape`
is just a record of these, keyed by column name.

The runtime `columnType(...)` builder has eight overloads, one per
`(nullable, hasDefault, isGenerated)` combination. That verbosity buys
something specific: when you write `columnType<number, "int4">({...})`
with the type arguments given explicitly, TypeScript won't also infer
the trailing boolean parameters from the argument. Spelling out each
combination as its own overload forces the literal `true`/`false` into
the result type, which everything downstream depends on.

## What a relation carries

A `Relation` has two phantom generics:

```ts
class Relation<Columns extends ColumnsShape, FKs extends ForeignKeyTuple>
```

`Columns` is the row shape the relation will produce; `FKs` is the
foreign-key tuple carried for join inference. Both are declared with
`declare readonly` and never read on a plain `Relation`, so they cost
nothing at runtime. Every operator transforms them:

- `where`, `order`, `limit`, `offset` return `Relation<Columns, FKs>`
  unchanged. They filter or reorder rows; they don't change the shape.
- `project` returns `Relation<ProjectedShape<Items>, FKs>`, a fresh
  shape computed from the projected items.
- `innerJoin` returns a `JoinBuilder` whose column shape is the two
  sides merged.

## From a shape to a row

`RowOf<Columns>` turns a `ColumnsShape` into the object type `db.run`
resolves to. It does three things: widen every nullable column by
`| null`, strip the `readonly` modifier (so the result matches the plain
mutable objects `pg` returns), and run the result through `Prettify` so
editors render the resolved `{ id: number; ... }` shape rather than a
chain of alias names. The nullable widening is the whole reason
`age: number | null` reaches you instead of `number`.

## Projection at the type level

`project(...)` is where the shape genuinely changes. It accepts a tuple
of `ProjectableItem`s (each a `Column` or an `AliasedColumn`), and
`ProjectedShape` rebuilds a `ColumnsShape` from them: each item
contributes one entry, keyed by `ItemOutputName` (the alias for an
`AliasedColumn`, the column name for a bare `Column`) and carrying the
item's original `ColumnType` via `ItemColumnType`. Because the entries
keep their `ColumnType`, a projected relation is still fully composable:
you can join or project it again.

## Brands: errors that wait for `db.run`

The interesting cases (an ambiguous join, a projection with two columns
of the same name) are caught not where you write them, but at the
`db.run(...)` call. The mechanism is a **brand**: an extra phantom field
intersected into the `Columns` shape, whose key is unique and whose type
is a literal-template string spelling out the error.

A brand rides through `where`, `order`, and the rest untouched, because
those preserve `Columns`. It only bites at the run site. The
plain-`Relation` overload of `Database.run` constrains its argument:

```ts
run<Columns extends ColumnsShape, ...>(
  statement: Relation<Columns, FKs> & { readonly _columns: UnbrandedColumns },
  ...
)
```

`UnbrandedColumns` declares every brand field as `?: never`. So if the
shape carries a brand, it fails to satisfy the constraint, and
TypeScript surfaces the brand's literal-template message right at the
`db.run` call. There are five brand fields, one per error:

| Brand field | Raised when |
| --- | --- |
| `__tenonDuplicateColumns` | A join's two sides share a column name |
| `__tenonInferenceSelfJoin` | An inferred join is a self-join |
| `__tenonInferenceMissing` | No foreign key connects the join's sides |
| `__tenonInferenceAmbiguous` | More than one foreign key connects them |
| `__tenonAmbiguousHasMany` | Two FKs on a child point at the parent |

### Duplicate columns

`MergedColumns<L, R>` is the join's combined shape. `DuplicateColumnNames`
intersects the two key sets; if the result isn't `never`, the merge adds
the `__tenonDuplicateColumns` brand naming the offending columns. This is
why joining two tables that both have `id` won't run until you
`project(...)` (which returns a fresh, unbranded shape) or `as(...)` one
side before joining.

### Join inference

This is the type-level mirror of the serialiser's FK inference, and it
catches the same three cases at compile time so the runtime throws never
fire in typed code. `FkBrand` picks the brand:

1. **Identity widened.** `AnyIdentityWidened` checks whether any of the
   four schema/name parameters is the wide `string` rather than a
   literal. That happens when the left side is a chained relation, not a
   bare `Table`, so its identity isn't statically known. The check bails
   out with no brand: inference can't be reasoned about, so it's left to
   the runtime backstop.
2. **Self-join.** `IsSamePhysicalTable` compares the two physical
   `(schema, name)` pairs.
3. **Match count.** `MatchesBetween` counts single-column FKs connecting
   the sides in either direction (`FkMatches` does the per-side tuple
   accumulation). Length 0 is `MissingFkBrand`, length 1 is fine, more
   than 1 is `AmbiguousFkBrand`.

Calling `.on(predicate)` returns a plain `MergedColumns` with no brand,
because an explicit predicate clears every inference-error case.

## Insert and update shapes

Insert and update derive their accepted-attributes types from the same
three flags. `InsertableAttrs` splits columns into required keys (NOT
NULL, no default, not generated) and optional keys (nullable or has a
default), with generated columns absent entirely; nullable optionals
also accept `null`. `UpdatableAttrs` makes every non-generated column
optional and ignores `hasDefault`, since defaults apply only on insert.
The user-facing rules these produce are in
[the type mapping](../using/type-mapping.md); the derivations are
`RequiredInsertKeys`, `OptionalInsertKeys`, and the mapped types in
`types.ts`.

## Accessor maps

`find` and the relationship accessors are also typed here. `AccessorsFor`
is `HasManyAccessors & BelongsToAccessors`, each computed by iterating
the whole schema bag that `defineSchema` passes in. A has-many accessor
is keyed by a child table's physical name and valued as a `Relation` over
the child's columns; a belongs-to accessor is keyed by the FK column with
`_id` stripped (or the referenced table name) and valued as a `SingleRow`
over the referenced columns. The same `FkMatches` counting drives them,
and an ambiguous has-many gets the `__tenonAmbiguousHasMany` brand. How
`defineSchema` feeds the schema bag in is covered in
[the schema runtime](schema-runtime.md).

One deliberate limit: a belongs-to accessor's value is a plain
`SingleRow`, not a wired one, so a chained walk like
`find().post.author` doesn't compile. Chaining would need a join-backed
single-row runtime that doesn't exist yet.

## Why the errors wait

Surfacing these errors at `db.run` rather than at the operator is what
keeps relations composable. You can take an ambiguously-joined relation
and keep adding `.where(...)` to it; the brand rides along, and the error
appears once, at the point you actually try to run it, with a message
that names the fix. Each brand is the compile-time counterpart of a
runtime throw in the serialiser, so a query is rejected the same way
whether or not it was written in typed code.

## Where to go next

- [The query pipeline](pipeline.md): the type track running alongside
  the runtime tree, end to end.
- [The serialiser](serialiser.md): the runtime throws these brands
  mirror, especially for join inference.
- [The schema runtime](schema-runtime.md): where `ColumnType`,
  `defineTable`, and `defineSchema` produce the shapes this operates on.
- [Adding an operator](adding-an-operator.md): threading `Columns` and
  `FKs` through a new operator.
