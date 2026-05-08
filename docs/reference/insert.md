# `Insert<Columns, Returning>`

A pending `INSERT` statement, optionally with a `RETURNING`
projection.

```ts
import { Insert } from "@notahat/tenon";
```

You don't construct `Insert` directly — `Table.insert(attrs)`
produces it. The class is exported so test code and helpers can
name it.

## Phantoms

```ts
declare readonly _kind: "insert";
declare readonly _columns: Columns;
declare readonly _returning: Returning;
```

`_kind` distinguishes `Insert` from `Relation` and `Delete` in
`Database.run` overload resolution. `_columns` carries the source
table's shape. `_returning` is `null` when no `RETURNING` clause
is set (so `db.run` resolves to `{ rowCount }`) or a
`ColumnsShape` when one is (so `db.run` resolves to
`RowOf<Returning>[]`).

## `.returning(...items)`

```ts
returning<const Items extends readonly ProjectableItem[]>(
  ...items: Items
): Insert<Columns, ProjectedShape<Items>>;
```

Add (or replace) the `RETURNING` clause. Items are bare columns
(`users.id`) or aliased columns (`users.created_at.as("createdAt")`),
exactly as in `Relation.project`. The projected shape flows into
the `Returning` generic so `db.run(...)` resolves to typed rows.

## Example

```ts
const created = await db.run(
  users
    .insert({ email: "pete@notahat.com", active: true })
    .returning(users.id, users.createdAt),
);
//    ^? Array<{ id: number; createdAt: Date }>
```

Without `.returning(...)`:

```ts
const result = await db.run(
  users.insert({ email: "two@notahat.com", active: true }),
);
//    ^? { readonly rowCount: number }
```

## See also

- [Inserts guide](../guide/inserts.md).
- [`Table.insert`](table.md#insertattrs).
- [`InsertableAttrs`](types.md#insertableattrs) for the `attrs`
  shape.
- [`ProjectedShape`](types.md#projectedshape) for the
  RETURNING shape.
