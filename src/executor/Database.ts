// Thin wrapper around a node-postgres pool that runs typed Relations.
//
// Database does NOT own the lifecycle of the pool it is handed; the
// caller is responsible for `pool.end()`. A single pooled client may
// be supplied to `run` so callers managing their own transactions can
// route a query through the same client (transactions themselves are
// deferred to a later commit).
//
// Out of scope: streaming / cursor support; transaction management;
// custom type parsers (we trust pg's defaults to match the
// Postgres -> TS map declared in the schema runtime).

import type { Pool, PoolClient } from "pg";

import type { Relation } from "../query/Relation.js";
import type { RowOf } from "../query/types.js";
import type { ColumnsShape } from "../schema-runtime/columnType.js";
import { relationToSql } from "../sql/serialise.js";

/** A query runner accepted by `Database.run`. Both pg.Pool and pg.PoolClient match. */
interface QueryRunner {
  query(text: string, values: readonly unknown[]): Promise<{ rows: unknown[] }>;
}

export class Database {
  constructor(private readonly pool: Pool) {}

  /**
   * Compile and execute the given Relation. The result rows are typed
   * to match the relation's projected columns shape; nullable columns
   * widen by `| null`. Pass `client` to route through a specific
   * pooled client (e.g. one already inside a caller-managed
   * transaction).
   *
   * Relations whose columns shape has duplicate column names (carrying
   * the `__trelDuplicateColumns` brand from a join) are rejected at
   * compile time. Project before running, or alias one side via
   * `Table.as(...)` before joining.
   */
  async run<Columns extends ColumnsShape>(
    query: Relation<Columns> & {
      readonly _columns: { readonly __trelDuplicateColumns?: never };
    },
    client?: PoolClient,
  ): Promise<RowOf<Columns>[]> {
    const compiled = relationToSql(query.node);
    const runner: QueryRunner = client ?? this.pool;
    const result = await runner.query(compiled.text, [...compiled.params]);
    return result.rows as RowOf<Columns>[];
  }
}
