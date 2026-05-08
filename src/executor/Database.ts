// Thin wrapper around a node-postgres pool that runs typed Relations,
// Inserts, Updates, and Deletes.
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
import {
  RowNotFoundError,
  SingleRow,
  SingleRowOrThrow,
} from "../query/SingleRow.js";
import type {
  ForeignKeyTuple,
  RowOf,
  UnbrandedColumns,
} from "../query/types.js";
import { Update } from "../query/Update.js";
import type { ColumnsShape } from "../schema-runtime/columnType.js";
import {
  deleteToSql,
  insertToSql,
  relationToSql,
  updateToSql,
} from "../sql/serialise.js";

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
    statement: Update<Columns, Returning>,
    client?: PoolClient,
  ): Promise<RowOf<Returning>[]>;
  run<Columns extends ColumnsShape>(
    statement: Update<Columns, null>,
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
  run<Columns extends ColumnsShape>(
    statement: SingleRowOrThrow<Columns>,
    client?: PoolClient,
  ): Promise<RowOf<Columns>>;
  run<Columns extends ColumnsShape>(
    statement: SingleRow<Columns>,
    client?: PoolClient,
  ): Promise<RowOf<Columns> | null>;
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
      | Update<ColumnsShape, ColumnsShape | null>
      | Delete<ColumnsShape, ColumnsShape | null>
      | SingleRow<ColumnsShape>
      | SingleRowOrThrow<ColumnsShape>,
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
    if (statement instanceof Update) {
      const compiled = updateToSql(statement.node);
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
    if (statement instanceof SingleRowOrThrow) {
      const compiled = relationToSql(statement.node);
      const result = await runner.query(compiled.text, [...compiled.params]);
      const first = result.rows[0];
      if (first === undefined) {
        throw new RowNotFoundError();
      }
      return first;
    }
    if (statement instanceof SingleRow) {
      const compiled = relationToSql(statement.node);
      const result = await runner.query(compiled.text, [...compiled.params]);
      return result.rows[0] ?? null;
    }
    const compiled = relationToSql(statement.node);
    const result = await runner.query(compiled.text, [...compiled.params]);
    return result.rows;
  }
}
