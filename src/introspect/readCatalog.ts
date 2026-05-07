// Read table/column metadata from pg_catalog. Returns a flat list
// grouped at a higher layer (see emit.ts). Reading from pg_catalog
// rather than information_schema gives us direct access to type
// names and is conventionally faster.
//
// Out of scope: type mapping (src/introspect/mapTypes.ts); file
// emission (src/introspect/emit.ts).

import type { QueryResult } from "pg";

/** Anything that exposes a `query(text, values)` returning rows. */
export interface QueryRunner {
  query<Row extends Record<string, unknown>>(
    text: string,
    values: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface CatalogColumn {
  readonly schema: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly typname: string;
  readonly nullable: boolean;
  /**
   * True when the column has a DEFAULT clause or is an identity column
   * (serial / GENERATED ... AS IDENTITY); these columns are optional in
   * INSERTs.
   */
  readonly hasDefault: boolean;
  /**
   * True when the column is GENERATED ALWAYS AS (expr) STORED; these
   * columns cannot be supplied to INSERT.
   */
  readonly isGenerated: boolean;
}

const QUERY = `
  SELECT
    n.nspname        AS schema,
    c.relname        AS table_name,
    a.attname        AS column_name,
    t.typname        AS typname,
    NOT a.attnotnull AS nullable,
    (a.atthasdef OR a.attidentity <> '') AS has_default,
    (a.attgenerated <> '')               AS is_generated
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
  JOIN pg_type      t ON t.oid = a.atttypid
  WHERE n.nspname = ANY($1::text[])
    AND c.relkind IN ('r', 'v', 'm', 'p')
    AND a.attnum  > 0
    AND NOT a.attisdropped
  ORDER BY n.nspname, c.relname, a.attnum
`;

interface CatalogRow {
  [key: string]: unknown;
  schema: string;
  table_name: string;
  column_name: string;
  typname: string;
  nullable: boolean;
  has_default: boolean;
  is_generated: boolean;
}

/**
 * Query pg_catalog for every column in the given schemas. Tables,
 * views, materialised views, and partitioned tables are all returned;
 * dropped columns and system columns are excluded. Result rows are
 * ordered by (schema, table, attnum) so downstream emitters can rely
 * on input order to preserve column order within each table.
 */
export async function readCatalog(
  runner: QueryRunner,
  schemas: readonly string[],
): Promise<readonly CatalogColumn[]> {
  const result = await runner.query<CatalogRow>(QUERY, [schemas]);
  return result.rows.map((row) => ({
    schema: row.schema,
    tableName: row.table_name,
    columnName: row.column_name,
    typname: row.typname,
    nullable: row.nullable,
    hasDefault: row.has_default,
    isGenerated: row.is_generated,
  }));
}
