# The schema runtime

The schema runtime is the set of functions a generated schema file
calls. It turns a static description of your database into the typed
`Table` values you import and query. There are three, each at a
different grain: `columnType` per column, `defineTable` per table, and
`defineSchema` once over the whole set. They live in
`src/schema-runtime/`.

All three are pure construction. They read no database and perform no
I/O: the generator already did that, and emitted these calls as its
output. What they build is the boundary the rest of tenon stands on,
the fluent layer wraps these values, and the type system reasons about
the shapes they carry.

## `columnType`: one column

`columnType<TsType, SqlTag>({ nullable, hasDefault, isGenerated })` is
the per-column carrier. The two type parameters are phantom; the three
flags are real at runtime. It's the atom the other two functions build
on, and it has two fuller treatments already: [the type mapping](../using/type-mapping.md)
covers it from the outside (which Postgres type becomes which TS type),
and [the type system](types.md) covers the phantom mechanics and the
eight-overload trick that preserves the flags as literal types. This
document takes it as given.

## `defineTable`: one table

`defineTable(schema, name, columns, foreignKeys?, primaryKey?)` returns
a `Table`. A `Table` is a `Relation` (so `.where`, `.order`, `.project`
work on it directly) with several things merged in:

- **One `Column` accessor per declared column**, keyed by name, so
  `users.id` is a real `Column` value you build expressions from.
- **Metadata fields**: `_schema`, `_physicalName`, `_foreignKeys`,
  `_primaryKey`, and `_columnNames`. Most are phantom on `Relation`, but
  on a `Table` they carry real values, because `defineSchema` and the
  runtime accessor wiring need to read them.
- **Table-only methods**: `insert`, `delete`, `deleteAll`, `as`, and,
  conditionally, `find`. `where` is also overridden to return a
  `WritableScope` (a relation that additionally carries `.delete()`).

The construction goes through a shared `buildTable` helper, which both
`defineTable` (alias defaults to the table name) and `as` (caller picks
the alias) call. It creates one `TableRef` node, builds a `Column` for
each column name, and `Object.assign`s the accessors and methods onto a
`Relation`.

Three details are worth drawing out:

- **`as` preserves physical identity.** `users.as("u")` calls
  `buildTable` again with a new alias but the same `schema` and `name`.
  The alias changes how columns are qualified; the physical `(schema,
name)` is untouched. That's what lets the type system spot a self-join
  by comparing physical identities even after one side is re-aliased.
  Foreign keys and the primary key carry across unchanged, because they
  reference physical names, not aliases.
- **`find` is conditional.** It's installed only when the primary key is
  a single column. This mirrors the `FindMethod` type-level helper
  exactly: a table with an empty or composite key has no `find` in its
  type and none at runtime. When present, `find(id)` builds a
  `WHERE pk = $1 LIMIT 1` and returns a `WritableSingleRow`.
- **`innerJoin` is not overridden at runtime.** It's inherited from
  `Relation.prototype`. The `Table` type intersects in a tighter
  `innerJoin` signature that captures the literal `(schema, name)` of
  both sides, which is what feeds the join-inference brand. The runtime
  behaviour is identical either way; the override is purely type-level.

## `defineSchema`: the whole set

`defineSchema(tables)` takes a record of every `Table` and wires the
relationship accessors. It has to see all the tables at once, because an
accessor connects two of them: a single table can't know what points at
it. So this step is separate from `defineTable` by necessity.

It builds a `${schema}.${physicalName}` lookup over the bag, then walks
each table and **replaces its `find`** so the returned `SingleRow`
carries association accessors merged in. The tables are mutated in place
(only `find` is swapped) and the same record is returned, re-typed as
`WiredSchema` so each `find` reports the wider type. A table with no
`find` (no primary key, or a composite one) is left untouched.

Each wired `find` computes two accessor sets:

- **Has-many.** For every other table, find single-column foreign keys
  pointing back at this one. Skip self-references and any accessor name
  that would collide with a column already on the parent. With exactly
  one matching FK, build a `Relation` selecting from the child with the
  FK predicate baked in: no join is needed, because `find` already knows
  the parent's id, so the child's FK column is compared to it directly.
  With more than one match, skip at runtime; the type-level
  `AmbiguousHasManyBrand` carries the user-facing error.
- **Belongs-to.** For every single-column FK on this table, resolve the
  referenced parent through the lookup, derive the accessor name, and
  build a `SingleRow` whose SQL joins parent to child and filters by the
  child's primary key. A self-referential FK (a table pointing at
  itself, like `employees.manager_id`) aliases the child side, so the
  join doesn't emit the same physical name twice and trip Postgres's
  "table name specified more than once".

The accessor names come from `src/query/accessor-naming.ts`:
`hasManyAccessorName` uses the child table's physical name verbatim (no
pluralisation), and `belongsToAccessorName` strips a trailing `_id` from
the FK column (falling back to the referenced table's name when there
isn't one). Both the runtime wiring above and the type-level accessor
map call these same two functions, so they agree by construction.

One deliberate limit lives here: a belongs-to accessor returns a plain
`SingleRow` with no further accessors wired, so a chained walk like
`comments.find(5).post.author` doesn't compile. Chaining would need a
runtime where each accessor extends the join chain rather than starting
a fresh query, which is out of scope for v1. The type-level value is
plain `SingleRow` too, so the surface stays honest about what it
supports.

## Where to go next

- [The type system](types.md): the phantom shapes these values carry,
  including the accessor map `defineSchema` mirrors at the type level.
- [The AST](ast.md): the `TableRef` node `defineTable` builds and the
  FK metadata it attaches.
- [Relationships](../using/relationships.md): the `find` and accessor
  behaviour from a user's point of view.
