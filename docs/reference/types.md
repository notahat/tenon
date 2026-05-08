# Public type helpers

The TypeScript types tenon re-exports for use in application
code. All are erased at compile time.

```ts
import type {
  ComparableTo,
  InsertableAttrs,
  MergedColumns,
  ProjectableItem,
  ProjectedShape,
  RowOf,
} from "@notahat/tenon";
```

## `RowOf`

```ts
type RowOf<Columns extends ColumnsShape>;
```

The TS row type produced when executing a `Relation<Columns>`.
Each key is a column name; nullable columns widen by `| null`.
The `readonly` modifier is stripped so the row matches the plain
objects `pg` returns (callers may reassign).

```ts
type UserRow = RowOf<typeof users._columns>;
//   ^? { id: number; email: string; active: boolean; createdAt: Date }
```

Used internally by `Database.run` to type the rows it returns;
exported for application code that wants to name the row type
without invoking `db.run` first.

## `ComparableTo`

```ts
type ComparableTo<Type extends ColumnType<...>>;
```

The right-hand-side type for column comparators (`eq`, `neq`,
`lt`, ...). Three forms:

- a raw value of the column's TS type (becomes a `Parameter`);
- another `Column` whose TS type **and** SQL tag match (so
  `int4 = int4` works but `int4 = text` does not);
- an `Expression` whose result type matches.

`null` is **not** accepted — use `.isNull()` / `.isNotNull()`.

## `ProjectableItem`

```ts
type ProjectableItem = Column<...> | AliasedColumn<...>;
```

What `Relation.project`, `Insert.returning`, and `Delete.returning`
accept. Bare columns (output keyed by column name) or aliased
columns (output keyed by `as("name")` alias).

## `ProjectedShape`

```ts
type ProjectedShape<Items extends readonly ProjectableItem[]>;
```

Build a columns shape from a tuple of projectable items. Used by
the projection-aware operators to compute the resulting
`Relation` / `Insert` / `Delete` type. Useful when threading a
projected shape through your own helper functions.

## `MergedColumns`

```ts
type MergedColumns<L extends ColumnsShape, R extends ColumnsShape>;
```

Combined columns shape for an inner-joined relation: the union of
both sides' columns, keyed by name. When the two sides share any
column names, the type intersects in a brand:

```ts
__tenonDuplicateColumns:
  `tenon: joined relation has duplicate columns: ${...};
   project(...) before db.run, or as(...) one side before joining`;
```

The brand survives `.where`, `.order`, `.limit`, but is rejected
at `Database.run`. Two ways to fix:

- `project(...)` to a non-overlapping shape (the brand is
  computed off the projected shape, which has no overlap).
- `Table.as("alias")` one side before joining so the merged shape
  has no overlap to begin with.

See the [joins guide](../guide/joins.md).

## `InsertableAttrs`

```ts
type InsertableAttrs<Columns extends ColumnsShape>;
```

The TS shape `Table.insert(attrs)` accepts. Derived from the
column flags:

- **Required keys**: NOT NULL, no DEFAULT, not generated.
- **Optional keys**: nullable or has DEFAULT, not generated.
  Nullable keys also accept `null`.
- **Forbidden keys**: generated. Absent from the type entirely;
  supplying one is a "no such property" error.

See the [inserts guide](../guide/inserts.md).
