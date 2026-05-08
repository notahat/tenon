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

`run` has seven overloads, declared **before** the implementation
signature:

```ts
run<C, R>(statement: Delete<C, R>, client?: PoolClient): Promise<RowOf<R>[]>;
run<C>(statement: Delete<C, null>, client?: PoolClient): Promise<{ readonly rowCount: number }>;
run<C, R>(statement: Insert<C, R>, client?: PoolClient): Promise<RowOf<R>[]>;
run<C>(statement: Insert<C, null>, client?: PoolClient): Promise<{ readonly rowCount: number }>;
run<C>(statement: SingleRowOrThrow<C>, client?: PoolClient): Promise<RowOf<C>>;
run<C>(statement: SingleRow<C>, client?: PoolClient): Promise<RowOf<C> | null>;
run<C>(statement: Relation<C> & { ...no-brand check... }, client?: PoolClient): Promise<RowOf<C>[]>;
```

Order matters within a class:

- For both `Insert` and `Delete`, the `Returning extends ColumnsShape`
  overload comes **before** the `Returning extends null` one.
  TypeScript picks the first overload that fits; putting the
  more-specific overload first means `.returning(...)` calls
  resolve to the rows form, not the rowCount form.
- `SingleRowOrThrow` comes before `SingleRow` for the same
  reason: the throwing variant has the narrower return type
  (`RowOf<C>`), so listing it first lets `find(id).orThrow()`
  pick it over the nullable form.
- The `Relation` overload comes last. Its argument type
  intersects in a structural check
  (`{ readonly _columns: { readonly __tenonDuplicateColumns?: never } }`)
  that rejects relations carrying the duplicate-column brand
  from a join. The brand becomes a compile error at the call
  site rather than a "weird Postgres error" at runtime.

Order between classes (Delete / Insert / SingleRow / Relation)
doesn't matter for type-level dispatch — they're discriminated
by class — but the implementation cascade reads top to bottom,
so keep the order consistent.

`SingleRow` and `Relation` are the one place where the dispatch
needs help from a phantom field: both wrap a `RelationNode`, so
`Relation<C>` is structurally assignable to `SingleRow<C>`.
Without a discriminator, TypeScript would happily match the
`SingleRow` overload for plain Relations, returning `RowOf<C> |
null` instead of `RowOf<C>[]`. The
`declare readonly _kind: "SingleRow"` phantom on `SingleRow`
breaks that match — Relation has no `_kind` field, so it can't
satisfy the SingleRow overload. (This is the cross-class
discriminator pattern documented in
[fluent-layer.md](fluent-layer.md#phantom-types).)

## Implementation cascade

The implementation signature accepts a union and dispatches by
`instanceof`:

```ts
async run(statement, client?) {
  const runner = client ?? this.pool;
  if (statement instanceof Insert) {
    const compiled = insertToSql(statement.node);
    const result = await runner.query(compiled.text, [...compiled.params]);
    if (statement.node.returning === null) return { rowCount: result.rowCount ?? 0 };
    return result.rows;
  }
  if (statement instanceof Delete) {
    // identical shape, deleteToSql instead
  }
  if (statement instanceof SingleRowOrThrow) {
    const compiled = relationToSql(statement.node);
    const result = await runner.query(compiled.text, [...compiled.params]);
    const first = result.rows[0];
    if (first === undefined) throw new RowNotFoundError();
    return first;
  }
  if (statement instanceof SingleRow) {
    const compiled = relationToSql(statement.node);
    const result = await runner.query(compiled.text, [...compiled.params]);
    return result.rows[0] ?? null;
  }
  // fall through: it's a Relation
  const compiled = relationToSql(statement.node);
  const result = await runner.query(compiled.text, [...compiled.params]);
  return result.rows;
}
```

`instanceof` is the cheapest, most explicit dispatch; it doesn't
care about the type-system phantoms. The runtime correctness
check is "what class is this", not "what generics does it carry".

The `Insert` and `Delete` branches both check `statement.node.returning
=== null` to pick between the rowCount form and the rows form.
That's the runtime mirror of the overloads on `_returning`.

The `SingleRow` and `SingleRowOrThrow` branches share the same
`relationToSql` path as the `Relation` branch — there is no
SingleRow-specific AST node — and differ only in how they
unwrap the result rows. The `SingleRowOrThrow` check has to
come **before** `SingleRow`: `SingleRowOrThrow` is its own
class, but if it inherited from `SingleRow` it would also pass
`instanceof SingleRow` and silently route through the wrong
branch. They don't inherit from each other today, so the order
is style only — but flipping it would be a footgun if that
relationship ever changes.

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
