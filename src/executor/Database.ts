// Thin wrapper around a node-postgres pool that runs typed Relations
// and Inserts.
//
// Database does NOT own the lifecycle of the pool it is handed; the
// caller is responsible for `pool.end()`. A single pooled client may
// be supplied to `run` so callers managing their own transactions can
// route a query through the same client.
//
// Out of scope: streaming / cursor support; transaction management
// (not yet supported); custom type parsers (we trust pg's defaults to
// match the Postgres -> TS map declared in the schema runtime).

import type { Pool, PoolClient } from "pg";

import { Delete } from "../query/Delete.js";
import { Insert } from "../query/Insert.js";
import type { Relation } from "../query/Relation.js";
import type {
  ForeignKeyTuple,
  RowOf,
  UnbrandedColumns,
} from "../query/types.js";
import type { ColumnsShape } from "../schema-runtime/columnType.js";
import { deleteToSql, insertToSql, relationToSql } from "../sql/serialise.js";

/** A query runner accepted by `Database.run`. Both pg.Pool and pg.PoolClient match. */
interface QueryRunner {
  query(
    text: string,
    values: readonly unknown[],
  ): Promise<{ rows: unknown[]; rowCount: number | null }>;
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
   * the `__tenonDuplicateColumns` brand from a join) are rejected at
   * compile time. Project before running, or alias one side via
   * `Table.as(...)` before joining.
   */
  run<Columns extends ColumnsShape, Returning extends ColumnsShape>(
    statement: Delete<Columns, Returning>,
    client?: PoolClient,
  ): Promise<RowOf<Returning>[]>;
  run<Columns extends ColumnsShape>(
    statement: Delete<Columns, null>,
    client?: PoolClient,
  ): Promise<{ readonly rowCount: number }>;
  run<Columns extends ColumnsShape, Returning extends ColumnsShape>(
    statement: Insert<Columns, Returning>,
    client?: PoolClient,
  ): Promise<RowOf<Returning>[]>;
  run<Columns extends ColumnsShape>(
    statement: Insert<Columns, null>,
    client?: PoolClient,
  ): Promise<{ readonly rowCount: number }>;
  run<Columns extends ColumnsShape, FKs extends ForeignKeyTuple = readonly []>(
    statement: Relation<Columns, FKs> & {
      readonly _columns: UnbrandedColumns;
    },
    client?: PoolClient,
  ): Promise<RowOf<Columns>[]>;
  async run(
    statement:
      | Relation<ColumnsShape, ForeignKeyTuple>
      | Insert<ColumnsShape, ColumnsShape | null>
      | Delete<ColumnsShape, ColumnsShape | null>,
    client?: PoolClient,
  ): Promise<unknown> {
    const runner: QueryRunner = client ?? this.pool;
    if (statement instanceof Insert) {
      const compiled = insertToSql(statement.node);
      const result = await runner.query(compiled.text, [...compiled.params]);
      if (statement.node.returning === null) {
        return { rowCount: result.rowCount ?? 0 };
      }
      return result.rows;
    }
    if (statement instanceof Delete) {
      const compiled = deleteToSql(statement.node);
      const result = await runner.query(compiled.text, [...compiled.params]);
      if (statement.node.returning === null) {
        return { rowCount: result.rowCount ?? 0 };
      }
      return result.rows;
    }
    const compiled = relationToSql(statement.node);
    const result = await runner.query(compiled.text, [...compiled.params]);
    return result.rows;
  }
}
