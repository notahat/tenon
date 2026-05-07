// Builds a runtime Table from a schema declaration.
//
// Generated schema files call this once per table. The returned value
// is a `Relation` (so `.where`, `.order`, etc. work directly on it)
// with one Column accessor merged in per declared column. Users
// reference columns directly via the table name (`users.id`) and chain
// relation operators in the same expression.
//
// Out of scope: introspection / code generation (src/introspect/...);
// per-row TS types (those flow from the columns map's element types).

import { deleteNode } from "../ast/delete.js";
import { insertColumnValue, insertNode } from "../ast/insert.js";
import { parameter } from "../ast/expression.js";
import { tableRef, where as whereNode } from "../ast/relation.js";
import { Column } from "../query/Column.js";
import { Delete } from "../query/Delete.js";
import { DeletableScope } from "../query/DeletableScope.js";
import type { Expression } from "../query/Expression.js";
import { Insert } from "../query/Insert.js";
import { Relation } from "../query/Relation.js";
import type { InsertableAttrs } from "../query/types.js";
import type { ColumnType, ColumnsShape } from "./columnType.js";

/**
 * The shape of a defined table: a Relation with column accessors
 * merged in. The `Alias` parameter is the qualifier used in column
 * references and (when not equal to the physical name) in
 * `FROM ... AS ...`. After `defineTable` it equals the table name;
 * after `.as("u")` it carries the user-supplied alias.
 */
export type Table<Alias extends string, Columns extends ColumnsShape> = Omit<
  Relation<Columns>,
  "where"
> &
  Readonly<{
    _tableName: Alias;
    _schema: string;
  }> & {
    readonly [Name in keyof Columns & string]: Column<
      Alias,
      Name,
      Columns[Name]
    >;
  } & {
    /**
     * Re-alias this table for use in joins. The returned Table shares
     * the same physical schema and name but qualifies its columns by
     * the new alias, so the same physical table can appear twice in
     * one query (self-joins, plus column-name disambiguation).
     */
    as<NewAlias extends string>(alias: NewAlias): Table<NewAlias, Columns>;
    /**
     * Build an INSERT against this table. Required keys (NOT NULL, no
     * DEFAULT, not generated) must be supplied; nullable keys and keys
     * with defaults are optional; generated columns are absent from
     * the attrs type entirely. Chain `.returning(...)` to read inserted
     * rows; without it, `db.run(...)` resolves to `{ rowCount }`.
     */
    insert(attrs: InsertableAttrs<Columns>): Insert<Columns, null>;
    /**
     * Narrow this table for read or DELETE. The returned scope is a
     * Relation (so `.order`, `.limit`, etc. all work for SELECTs) but
     * also carries `.delete()`, which builds a DELETE using the
     * accumulated predicate chain.
     */
    where(predicate: Expression<boolean>): DeletableScope<Alias, Columns>;
    /**
     * Footgun catch: builds a DELETE with no WHERE clause and the
     * `allowEmptyPredicates` flag off. The serialiser refuses to emit
     * it; the error message points at `deleteAll()`. Always go through
     * `.where(...).delete()` or `.deleteAll()` instead.
     */
    delete(): Delete<Columns, null>;
    /**
     * Build a DELETE that wipes every row in this table. The
     * `allowEmptyPredicates` flag is set so the serialiser does not
     * throw. Reach for this only when you genuinely want to clear the
     * table; otherwise narrow with `.where(...)` first.
     */
    deleteAll(): Delete<Columns, null>;
  };

/**
 * Define a table. The default alias for column qualification is the
 * table name itself; rename it for joins via `.as("u")`.
 */
export function defineTable<
  TableName extends string,
  Columns extends ColumnsShape,
>(
  schema: string,
  name: TableName,
  columns: Columns,
): Table<TableName, Columns> {
  return buildTable(schema, name, name, columns) as Table<TableName, Columns>;
}

/**
 * Construct a Table for the given physical (schema, name) under the
 * given column-qualification alias. Shared between `defineTable` (where
 * the alias defaults to the table name) and `Table.as` (where the user
 * picks the alias).
 */
function buildTable<Alias extends string, Columns extends ColumnsShape>(
  schema: string,
  name: string,
  alias: Alias,
  columns: Columns,
): Table<Alias, Columns> {
  const node =
    alias === name
      ? tableRef({ schema, name })
      : tableRef({ schema, name, alias });
  const relation = new Relation<Columns>(node);
  const accessors: Record<
    string,
    Column<
      string,
      string,
      ColumnType<unknown, string, boolean, boolean, boolean>
    >
  > = {};
  for (const columnName of Object.keys(columns)) {
    accessors[columnName] = new Column(alias, columnName);
  }
  Object.assign(relation, accessors, {
    _tableName: alias,
    _schema: schema,
    as<NewAlias extends string>(newAlias: NewAlias): Table<NewAlias, Columns> {
      return buildTable(schema, name, newAlias, columns);
    },
    insert(attrs: InsertableAttrs<Columns>): Insert<Columns, null> {
      const columnValues = Object.entries(attrs as Record<string, unknown>).map(
        ([columnName, value]) =>
          insertColumnValue(columnName, parameter(value)),
      );
      return new Insert<Columns, null>(
        insertNode({ target: node, columnValues }),
      );
    },
    where(predicate: Expression<boolean>): DeletableScope<Alias, Columns> {
      return new DeletableScope<Alias, Columns>(
        whereNode(node, predicate.node),
        node,
      );
    },
    delete(): Delete<Columns, null> {
      return new Delete<Columns, null>(
        deleteNode({ target: node, allowEmptyPredicates: false }),
      );
    },
    deleteAll(): Delete<Columns, null> {
      return new Delete<Columns, null>(
        deleteNode({ target: node, allowEmptyPredicates: true }),
      );
    },
  });
  return relation as Table<Alias, Columns>;
}
