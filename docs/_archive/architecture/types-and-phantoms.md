# Types and phantoms

The type-level machinery: what each type does, where it lives,
and a worked example showing a column threading through the
pipeline.

## Where the types live

Three thick files plus a sprinkle:

- **`src/schema-runtime/columnType.ts`** — `ColumnType`,
  `ColumnsShape`, the `columnType<TS, SQL>(...)` overload set.
- **`src/schema-runtime/foreignKey.ts`,
  `src/schema-runtime/primaryKey.ts`** — the FK and PK metadata
  shapes, threaded into the Table type and read by accessor
  inference.
- **`src/query/types.ts`** — `RowOf`, `MergedColumns`,
  `InsertableAttrs`, `ProjectedShape`, `ComparableTo`,
  `DuplicateColumnNames`, `Prettify`, `ItemOutputName`,
  `ItemColumnType`, the FK-inference machinery
  (`ForeignKeyTuple`, `MergedForeignKeys`, `IsSamePhysicalTable`,
  `SelfJoinBrand`, `MissingFkBrand`, `AmbiguousFkBrand`,
  `MergedColumnsWithFkBrand`), and the FK-accessor association
  map (`TableShape`, `HasManyAccessors`, `BelongsToAccessors`,
  `AccessorsFor`, `WiredSingleRow`, `AmbiguousHasManyBrand`).
- **`src/schema-runtime/defineSchema.ts`** — `WiredSchema<S>`
  and `WiredTable<T, S>`, which describe the runtime mutation
  defineSchema performs on each input Table.
- **Per-class phantoms** — declared inline in `Relation`,
  `Insert`, `Update`, `Delete`, `WritableScope`, `SingleRow`,
  `Column`, `AliasedColumn`, `Expression`, `JoinBuilder`. See
  [fluent-layer.md](fluent-layer.md).

## `ColumnType<TsType, SqlTag, Nullable, HasDefault, IsGenerated>`

The carrier for a single column's static and dynamic shape. Five
generics:

- `TsType` — TypeScript type produced when reading this column
  (e.g. `number`, `string`, `Date`).
- `SqlTag` — Postgres `typname` (e.g. `"int4"`, `"text"`,
  `"timestamptz"`).
- `Nullable` — `true` if values may be NULL.
- `HasDefault` — `true` if the column has a `DEFAULT` clause or
  is an identity column.
- `IsGenerated` — `true` for `GENERATED ... STORED` columns.

`TsType` and `SqlTag` are **phantom** (declared as
`readonly _tsType: TsType` / `readonly _sqlTag: SqlTag`, never
assigned). The three boolean flags exist both in the type and at
runtime — runtime so the introspector can write them into the
generated file, type so `RowOf` and `InsertableAttrs` can read
them.

## `columnType` and the eight overloads

`columnType` is overloaded once per `(nullable, hasDefault,
isGenerated)` triple — eight overloads. The reason: a single
generic signature with `Nullable extends boolean` does not
preserve literals when `<TsType, SqlTag>` are passed explicitly:

```ts
// With one generic signature, this would resolve to
//   ColumnType<number, "int4", boolean, boolean, boolean>
// — losing the literal `true`/`false` flags.

columnType<number, "int4">({
  nullable: false,
  hasDefault: true,
  isGenerated: false,
});
```

The overloads force literal-preservation by matching object
literals exactly. Verbose but the call-site narrowing is
essential — `RowOf` needs `Nullable extends true`, and
`InsertableAttrs` needs `HasDefault extends true` /
`IsGenerated extends true`.

## `RowOf<Columns>`

```ts
type RowOf<Columns extends ColumnsShape> = Prettify<{
  -readonly [Name in keyof Columns]: Columns[Name]["nullable"] extends true
    ? Columns[Name]["_tsType"] | null
    : Columns[Name]["_tsType"];
}>;
```

The TS row type produced when executing a `Relation<Columns>`.
Nullable columns widen by `| null`; the `readonly` modifier is
stripped so the row matches the plain objects `pg` returns.

`Prettify<T>` is a structural no-op (`{ [K in keyof T]: T[K] } &
{}`) that forces the editor to display the resolved shape rather
than the alias chain. Without it, hovering over a row variable
shows `RowOf<typeof users._columns>` instead of `{ id: number;
email: string; ... }`.

## `MergedColumns<L, R>` and the duplicate-column brand

```ts
type MergedColumns<L extends ColumnsShape, R extends ColumnsShape> =
  DuplicateColumnNames<L, R> extends never
    ? Readonly<L & R>
    : Readonly<L & R> & {
        readonly __tenonDuplicateColumns: `tenon: joined relation has duplicate columns: ${DuplicateColumnNames<L, R>}; project(...) before db.run, or as(...) one side before joining`;
      };
```

When two joined tables share column names, the merged type
intersects in a brand: an unforgeable `__tenonDuplicateColumns`
field whose value is a literal-template **error message**.

The brand survives `.where`, `.order`, `.limit` (which all
preserve the columns shape), but is rejected at `Database.run`:
the `Relation` overload requires
`{ readonly __tenonDuplicateColumns?: never }`, which the
brand violates.

`.project(...)` builds a fresh `Relation` whose columns shape is
`ProjectedShape<Items>` — computed off the projected items, no
join-merge involved. The brand doesn't propagate, so the
projected relation runs cleanly.

The literal-template error message is what TypeScript surfaces
at the run site. It names the offending columns inline so the
user doesn't need to chase the diagnostic.

## FK-inference brands

Three more brands ride alongside `__tenonDuplicateColumns`,
applied to a `JoinBuilder`'s merged-columns shape when the
foreign-key inference path can't pick a unique predicate:

```ts
type SelfJoinBrand<Schema, Name> = {
  readonly __tenonInferenceSelfJoin: `tenon: ... self-join on ${Schema}.${Name} ...`;
};
type MissingFkBrand<LSchema, LName, RSchema, RName> = {
  readonly __tenonInferenceMissing: `tenon: ... no foreign key between ${LSchema}.${LName} and ${RSchema}.${RName} ...`;
};
type AmbiguousFkBrand<LSchema, LName, RSchema, RName> = {
  readonly __tenonInferenceAmbiguous: `tenon: ... ambiguous foreign keys between ${LSchema}.${LName} and ${RSchema}.${RName} ...`;
};
```

`MergedColumnsWithFkBrand<L, R, LFKs, LSchema, LName, RFKs, RSchema, RName>`
picks one (or none) by:

1. If any of the four identity generics is the wide `string` type
   (e.g. the left side was a chained `Relation`, not a `Table`),
   no brand is applied — inference falls through to the
   serialiser's runtime check.
2. `IsSamePhysicalTable<LSchema, LName, RSchema, RName>` →
   self-join brand.
3. `MatchesBetween<...>['length']` is 0 → missing brand.
4. `MatchesBetween<...>['length']` is 1 → no brand (ok).
5. Otherwise → ambiguous brand.

`MatchesBetween` is a `[...FkMatches<LFKs, RSchema, RName>,
...FkMatches<RFKs, LSchema, LName>]` tuple — single-column FK
matches in either direction. Composite FKs are filtered out by a
`Head["columns"]["length"] extends 1` check.

`Database.run`'s relation overload rejects all four brands:

```ts
run<Columns, FKs>(
  query: Relation<Columns, FKs> & {
    readonly _columns: {
      readonly __tenonDuplicateColumns?: never;
      readonly __tenonInferenceSelfJoin?: never;
      readonly __tenonInferenceMissing?: never;
      readonly __tenonInferenceAmbiguous?: never;
    };
  },
  ...
);
```

Calling `.on(predicate)` on the JoinBuilder returns plain
`Relation<MergedColumns<L, R>, MergedForeignKeys<LFKs, RFKs>>` —
no brand — so an explicit predicate clears any inference error.

## FK-accessor association map

The same FK metadata that drives implicit-ON inference also
drives the accessor map merged onto SingleRows by
`defineSchema`. The walk happens at the type level so users see
the right shape at the call site; the runtime mirror lives in
`defineSchema`.

`TableShape` is the structural extraction the type-level walk
reads off each Table. The full Table type is wider — it carries
column accessors, relation methods, and so on — but only these
phantom fields drive accessor inference, so isolating them keeps
the association-map machinery decoupled:

```ts
interface TableShape {
  readonly _columns: ColumnsShape;
  readonly _columnNames: readonly string[];
  readonly _foreignKeys: ForeignKeyTuple;
  readonly _primaryKey: PrimaryKey;
  readonly _schema: string;
  readonly _physicalName: string;
}
```

`_columnNames` is the only field with a real runtime value (the
runtime mirror in `defineSchema` reads it to detect accessor /
column-name collisions); the rest are phantoms.

### `HasManyAccessors<T, S>`

```ts
type HasManyAccessors<T, S> = {
  [K in keyof S as HasManyAccessorKey<T, S[K]>]: HasManyAccessorValue<T, S[K]>;
};
```

For each table `S[K]` in the schema bag, decide whether to
contribute a has-many accessor to `T`'s SingleRow. The
key-picker `HasManyAccessorKey` returns `never` (which removes
the entry from the mapped type) in three cases:

1. **Self-reference.** `S[K]` and `T` resolve to the same
   physical (schema, name).
2. **No matching FKs.** `FkMatches<S[K]["_foreignKeys"],
   T["_schema"], T["_physicalName"]>['length']` is `0`.
3. **Column-name shadow.** The accessor name (the child's
   physical name) is already a column on `T`.

Otherwise the key is the child's physical name and the value is
`Relation<S[K]["_columns"], S[K]["_foreignKeys"]>`. When more
than one FK on the child points at the parent, the columns
shape is intersected with `AmbiguousHasManyBrand` instead — the
brand rides inside the columns shape (not on the Relation
itself) so `UnbrandedColumns` catches it at `db.run` time, the
same way duplicate-column and self-join brands surface.

### `BelongsToAccessors<T, S>`

```ts
type BelongsToAccessors<T, S> = {
  [Index in keyof T["_foreignKeys"] as BelongsToAccessorKey<
    T["_foreignKeys"][Index & number],
    T["_columns"],
    S
  >]: BelongsToAccessorValue<T["_foreignKeys"][Index & number], S>;
};
```

Iterates `T`'s outgoing FKs, looks up each FK's referenced
table in `S` via `LookupTableByPhysical<S, RefSchema, RefName>`,
and adds an accessor named by `StripIdSuffix<FkColumn,
RefTable>` (drop a trailing `_id`, falling back to the
referenced table's name verbatim). The key-picker filters out
composite FKs, accessor-name collisions with `T`'s columns, and
FKs whose target isn't in `S`.

The accessor's value type is plain `SingleRow<Ref["_columns"]>`
in v1 — not the recursive `WiredSingleRow<Ref, S>` — so chained
walks like `comments.find(5).post.author` don't compile.
Implementing chains needs a chained-join runtime where each
accessor extends an existing query rather than starting a new
one; that's a v1.12 follow-up.

### `WiredSingleRow<T, S>` and the four `Wired*` types

```ts
type AccessorsFor<T, S> = HasManyAccessors<T, S> & BelongsToAccessors<T, S>;
type WiredSingleRow<T, S> = SingleRow<T["_columns"]> & AccessorsFor<T, S>;
```

`WiredSingleRow` is what `Table.find(id)` returns once the
table has been through `defineSchema`. The non-recursive
restriction on belongs-to means follow-up `.author` calls can't
resolve, but the top-level accessors (has-many and belongs-to
from `find`) are fully wired.

`WiredSchema<S>` and `WiredTable<T, S>` (from
`src/schema-runtime/defineSchema.ts`) are the user-facing types
on the wiring boundary. `WiredTable` strips the original `find`
method off the input Table via `Omit` and re-adds it with the
`WiredSingleRow` return type — direct intersection wouldn't
narrow the return type because TypeScript would pick the more
permissive of the two `find` signatures.

## `InsertableAttrs<Columns>`

```ts
type RequiredInsertKeys<Columns> = {
  [Name in keyof Columns]: Columns[Name]["isGenerated"] extends true
    ? never
    : Columns[Name]["nullable"] extends true
      ? never
      : Columns[Name]["hasDefault"] extends true
        ? never
        : Name;
}[keyof Columns];

type OptionalInsertKeys<Columns> = {
  [Name in keyof Columns]: Columns[Name]["isGenerated"] extends true
    ? never
    : Columns[Name]["nullable"] extends true
      ? Name
      : Columns[Name]["hasDefault"] extends true
        ? Name
        : never;
}[keyof Columns];

type InsertableAttrs<Columns> = Prettify<
  { [Name in RequiredInsertKeys<Columns>]: Columns[Name]["_tsType"] } & {
    [Name in OptionalInsertKeys<Columns>]?: Columns[Name]["nullable"] extends true
      ? Columns[Name]["_tsType"] | null
      : Columns[Name]["_tsType"];
  }
>;
```

Three buckets, computed by reading the per-column flags:

- **Required** — not generated, not nullable, no default.
- **Optional** — not generated, AND (nullable OR has default).
  Nullable optional columns also accept `null`.
- **Forbidden** — generated. Filtered to `never` in both maps,
  so the field doesn't appear in the resulting type. Supplying
  one is a "no such property" error.

## `ProjectedShape<Items>`

```ts
type ItemOutputName<Item> =
  Item extends AliasedColumn<infer Name, ...> ? Name
  : Item extends Column<string, infer Name, ...> ? Name
  : never;

type ItemColumnType<Item> =
  Item extends AliasedColumn<string, infer Type> ? Type
  : Item extends Column<string, string, infer Type> ? Type
  : never;

type ProjectedShape<Items extends readonly ProjectableItem[]> = {
  readonly [Item in Items[number] as ItemOutputName<Item>]: ItemColumnType<Item>;
};
```

Build a columns shape from a tuple of projectable items. Each
item becomes one entry keyed by its output name and carrying its
column type — so the projected relation stays composable
(`projected.where(...)` still type-checks, the row type infers
correctly, and so on).

`ItemOutputName` reads the output name (alias for
`AliasedColumn`, column name for bare `Column`); `ItemColumnType`
reads the carried `ColumnType`.

## Worked example

A column threading from `tenon-generate` to a `db.run` row type:

1. **Catalog row.** Postgres reports `users.email` as
   `typname = "text", attnotnull = true, atthasdef = false,
attgenerated = ""`.
2. **Generated file.** `tenon-generate` writes:

   ```ts
   email: columnType<string, "text">({
     nullable: false,
     hasDefault: false,
     isGenerated: false,
   }),
   ```

   The triple `(false, false, false)` selects the first
   overload, returning
   `ColumnType<string, "text", false, false, false>`.

3. **Table value.** `defineTable("public", "users", { email,
... })` returns a `Table<"users", Columns>`. The `email`
   property is a `Column<"users", "email", ColumnType<string,
"text", false, false, false>>`.

4. **Comparator.** `users.email.eq("pete@notahat.com")` produces
   `Expression<boolean>`. `ComparableTo<Type>` accepts a raw
   `string` (the `_tsType` of the column type), so the literal
   passes. `users.email.eq(42)` is rejected — `42` doesn't match
   `Type["_tsType"]`.

5. **Relation.** `users.where(...)` is a `Relation<Columns>`.
   The `Columns` generic preserves the email column type.

6. **Row type.** `RowOf<Columns>` reads
   `Columns["email"]["nullable"]` (`false`) and
   `Columns["email"]["_tsType"]` (`string`), producing
   `email: string` (no `| null`). After `Prettify`, the editor
   shows `{ ...; email: string; ... }` directly.

7. **Run.** `db.run(users.where(users.email.eq(...)))` resolves
   to `Array<{ ...; email: string; ... }>`. The inner overload
   on `.run` requires no duplicate-column brand; the columns
   shape doesn't carry one (no join), so it passes.

Every step is type-level only. No bytes of the column metadata
flow at runtime past the schema-runtime flags.

## Worked example: `find` and an accessor

A second walk, showing the FK-accessor map threading through
`defineSchema` to a typed has-many call:

1. **Generated file.** `tenon-generate` emits

   ```ts
   export const { posts, users } = defineSchema({
     posts: defineTable("public", "posts", { ... }, [
       {
         name: "posts_author_id_fkey",
         columns: ["author_id"],
         referencedSchema: "public",
         referencedTable: "users",
         referencedColumns: ["id"],
       },
     ], { columns: ["id"] }),
     users: defineTable("public", "users", { ... }, [], { columns: ["id"] }),
   });
   ```

   Each `defineTable` returns a `Table<...>` carrying literal
   `_schema`, `_physicalName`, `_foreignKeys`, `_primaryKey`
   generics.

2. **`defineSchema` rewrites the Table types.**
   `WiredTable<T, S>` strips `find` from the input Table and
   re-adds it with return type
   `SingleRow<T["_columns"]> & AccessorsFor<T, S>`.

3. **`AccessorsFor<users, S>`** computes
   `HasManyAccessors<users, S> & BelongsToAccessors<users, S>`.
   The has-many walk visits `S["posts"]`, finds an FK in
   `posts._foreignKeys` whose `referencedSchema = "public"` and
   `referencedTable = "users"`, derives the accessor name
   `posts` (the child's physical name), and contributes
   `{ posts: Relation<postsColumns, postsFKs> }`. The
   belongs-to walk on `users` finds no outgoing FKs and
   contributes the empty record.

4. **`users.find(1)`** has return type
   `SingleRow<usersColumns> & { posts: Relation<postsColumns, postsFKs> }`.

5. **`users.find(1).posts`** is a `Relation<postsColumns,
   postsFKs>`. At runtime, the accessor is a real Relation
   wrapping
   `Where(TableRef("posts"), posts.author_id = $1)` with `$1`
   bound to `1` — a single-roundtrip SQL emit.

6. **`db.run(users.find(1).posts)`** resolves to
   `Array<{ id: number; author_id: number; ... }>`. The columns
   shape carries no brand (one-FK match in step 3), so the
   `Relation` overload on `Database.run` accepts it.

The recursive case — `comments.find(5).post.author` — is
explicitly out of scope: `BelongsToAccessorValue` returns plain
`SingleRow<Ref["_columns"]>`, so the second `.author` access
fails with "property does not exist". A future change makes
that `WiredSingleRow<Ref, S>`, paired with a runtime that
extends the join chain at each step.
