// Read table/column and foreign-key metadata from pg_catalog. Returns
// a flat catalog grouped at a higher layer (see emit.ts). Reading from
// pg_catalog rather than information_schema gives us direct access to
// type names and is conventionally faster.
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

/**
 * One foreign-key constraint. Composite FKs come back as a single
 * record with paired arrays (`columns[i]` references
 * `referencedColumns[i]`). Self-referential FKs are included; the
 * referencing and referenced (schema, table) pair are equal.
 * Cross-schema FKs are included as-is, even when the referenced
 * schema is outside the requested schema list.
 */
export interface CatalogForeignKey {
  readonly name: string;
  readonly schema: string;
  readonly tableName: string;
  readonly columns: readonly string[];
  readonly referencedSchema: string;
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
}

/** The full pg_catalog snapshot for a schema list. */
export interface Catalog {
  readonly columns: readonly CatalogColumn[];
  readonly foreignKeys: readonly CatalogForeignKey[];
}

const COLUMNS_QUERY = `
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

// pg_constraint stores conkey/confkey as int2[] arrays of attribute
// numbers, paired positionally. `generate_subscripts` lets us fan the
// constraint out to one row per pair, look up each side's column name,
// and re-aggregate in order. We filter by the *referencing* table's
// schema; the referenced side may be in any schema.
const FOREIGN_KEYS_QUERY = `
  SELECT
    con.conname        AS name,
    rel_n.nspname      AS schema,
    rel_c.relname      AS table_name,
    array_agg(rel_a.attname::text ORDER BY i) AS columns,
    ref_n.nspname      AS referenced_schema,
    ref_c.relname      AS referenced_table,
    array_agg(ref_a.attname::text ORDER BY i) AS referenced_columns
  FROM pg_constraint con
  JOIN pg_class      rel_c ON rel_c.oid = con.conrelid
  JOIN pg_namespace  rel_n ON rel_n.oid = rel_c.relnamespace
  JOIN pg_class      ref_c ON ref_c.oid = con.confrelid
  JOIN pg_namespace  ref_n ON ref_n.oid = ref_c.relnamespace
  JOIN LATERAL generate_subscripts(con.conkey, 1) AS i ON true
  JOIN pg_attribute  rel_a
    ON rel_a.attrelid = con.conrelid AND rel_a.attnum = con.conkey[i]
  JOIN pg_attribute  ref_a
    ON ref_a.attrelid = con.confrelid AND ref_a.attnum = con.confkey[i]
  WHERE con.contype = 'f'
    AND rel_n.nspname = ANY($1::text[])
  GROUP BY con.oid, con.conname,
           rel_n.nspname, rel_c.relname,
           ref_n.nspname, ref_c.relname
  ORDER BY rel_n.nspname, rel_c.relname, con.conname
`;

interface ColumnRow {
  [key: string]: unknown;
  schema: string;
  table_name: string;
  column_name: string;
  typname: string;
  nullable: boolean;
  has_default: boolean;
  is_generated: boolean;
}

interface ForeignKeyRow {
  [key: string]: unknown;
  name: string;
  schema: string;
  table_name: string;
  columns: string[];
  referenced_schema: string;
  referenced_table: string;
  referenced_columns: string[];
}

/**
 * Query pg_catalog for every column in the given schemas, plus every
 * foreign-key constraint declared on a table in those schemas. Tables,
 * views, materialised views, and partitioned tables are all returned;
 * dropped columns and system columns are excluded. Column rows are
 * ordered by (schema, table, attnum); FK rows by (schema, table,
 * constraint name).
 */
export async function readCatalog(
  runner: QueryRunner,
  schemas: readonly string[],
): Promise<Catalog> {
  const columnsResult = await runner.query<ColumnRow>(COLUMNS_QUERY, [schemas]);
  const foreignKeysResult = await runner.query<ForeignKeyRow>(
    FOREIGN_KEYS_QUERY,
    [schemas],
  );
  const columns = columnsResult.rows.map((row) => ({
    schema: row.schema,
    tableName: row.table_name,
    columnName: row.column_name,
    typname: row.typname,
    nullable: row.nullable,
    hasDefault: row.has_default,
    isGenerated: row.is_generated,
  }));
  const foreignKeys = foreignKeysResult.rows.map((row) => ({
    name: row.name,
    schema: row.schema,
    tableName: row.table_name,
    columns: row.columns,
    referencedSchema: row.referenced_schema,
    referencedTable: row.referenced_table,
    referencedColumns: row.referenced_columns,
  }));
  return { columns, foreignKeys };
}
