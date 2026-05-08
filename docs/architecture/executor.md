# Executor

`src/executor/Database.ts` — the only side-effecting layer. One
class, one method.

```ts
class Database {
  constructor(private readonly pool: Pool) {}
  run(query, client?): Promise<...>;
}
```

## Overload dispatch

`run` has five overloads, declared **before** the implementation
signature:

```ts
run<C, R>(remove: Delete<C, R>, client?: PoolClient): Promise<RowOf<R>[]>;
run<C>(remove: Delete<C, null>, client?: PoolClient): Promise<{ readonly rowCount: number }>;
run<C, R>(insert: Insert<C, R>, client?: PoolClient): Promise<RowOf<R>[]>;
run<C>(insert: Insert<C, null>, client?: PoolClient): Promise<{ readonly rowCount: number }>;
run<C>(query: Relation<C> & { ...no-brand check... }, client?: PoolClient): Promise<RowOf<C>[]>;
```

Order matters within a class:

- For both `Insert` and `Delete`, the `Returning extends ColumnsShape`
  overload comes **before** the `Returning extends null` one.
  TypeScript picks the first overload that fits; putting the
  more-specific overload first means `.returning(...)` calls
  resolve to the rows form, not the rowCount form.
- The `Relation` overload comes last. Its argument type
  intersects in a structural check
  (`{ readonly _columns: { readonly __tenonDuplicateColumns?: never } }`)
  that rejects relations carrying the duplicate-column brand
  from a join. The brand becomes a compile error at the call
  site rather than a "weird Postgres error" at runtime.

Order between classes (Delete / Insert / Relation) doesn't
matter because they're discriminated by class — but the
implementation cascade reads top to bottom, so keep the order
consistent.

## Implementation cascade

The implementation signature accepts a union and dispatches by
`instanceof`:

```ts
async run(query, client?) {
  const runner = client ?? this.pool;
  if (query instanceof Insert) {
    const compiled = insertToSql(query.node);
    const result = await runner.query(compiled.text, [...compiled.params]);
    if (query.node.returning === null) return { rowCount: result.rowCount ?? 0 };
    return result.rows;
  }
  if (query instanceof Delete) {
    // identical shape, deleteToSql instead
  }
  // fall through: it's a Relation
  const compiled = relationToSql(query.node);
  const result = await runner.query(compiled.text, [...compiled.params]);
  return result.rows;
}
```

`instanceof` is the cheapest, most explicit dispatch; it doesn't
care about the type-system phantoms. The runtime correctness
check is "what class is this", not "what generics does it carry".

The `Insert` and `Delete` branches both check `query.node.returning
=== null` to pick between the rowCount form and the rows form.
That's the runtime mirror of the overloads on `_returning`.

## `QueryRunner`

A small interface that both `pg.Pool` and `pg.PoolClient` satisfy:

```ts
interface QueryRunner {
  query(
    text: string,
    values: readonly unknown[],
  ): Promise<{ rows: unknown[]; rowCount: number | null }>;
}
```

`run` picks `client ?? this.pool` and treats both as
`QueryRunner`. This is the only type-level contract between
tenon and `pg`; everything else uses `pg`'s own types.

## What the executor doesn't do

- **No transaction wrapper.** Transactions today are managed by
  the caller via the `PoolClient` passthrough. A `db.transaction`
  helper is deferred — it would need to handle nesting (via
  savepoints), error propagation, and concurrent calls on the
  same client.
- **No streaming.** `runner.query(...)` materialises the full
  result set. Streaming would need a different path through `pg`
  (the `query` method on a `Cursor`-style result) and a
  different return shape on `Database.run`.
- **No retry / backoff.** Transient errors propagate.
- **No type parsers.** tenon trusts `pg`'s default parsers to
  match the Postgres-to-TS map declared in the schema runtime.

## What lives at this seam

`Database` is where tenon's compile-time types meet `pg`'s
runtime values. The contract is:

- The TS row type `RowOf<Columns>` matches what `pg` returns,
  given that the schema file's column types match the database.
  If the schema file is stale, `pg` returns whatever it returns
  and the static type lies. (`tenon-generate` exists to keep
  the schema file in sync; running it after every migration is
  the user's job.)
- Errors from `pg` propagate unchanged. Tenon-thrown errors
  (empty-WHERE DELETE, joining a non-table) all happen
  **before** `runner.query(...)` is called.
