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

import { tableRef } from "../ast/relation.js";
import { Column } from "../query/Column.js";
import { Relation } from "../query/Relation.js";
import type { ColumnType, ColumnsShape } from "./columnType.js";

/**
 * The shape of a defined table: a Relation with column accessors
 * merged in. The TableName literal type is preserved so future joins
 * can keep references qualified.
 */
export type Table<
  TableName extends string,
  Columns extends ColumnsShape,
> = Relation<Columns> &
  Readonly<{
    _tableName: TableName;
    _schema: string;
  }> & {
    readonly [Name in keyof Columns & string]: Column<
      TableName,
      Name,
      Columns[Name]
    >;
  };

/**
 * Define a table. The default alias for column qualification is the
 * table name itself; future joins may reassign it via a `.as` helper.
 */
export function defineTable<
  TableName extends string,
  Columns extends ColumnsShape,
>(
  schema: string,
  name: TableName,
  columns: Columns,
): Table<TableName, Columns> {
  const relation = new Relation<Columns>(tableRef({ schema, name }));
  const accessors: Record<
    string,
    Column<string, string, ColumnType<unknown, string, boolean>>
  > = {};
  for (const columnName of Object.keys(columns)) {
    accessors[columnName] = new Column(name, columnName);
  }
  Object.assign(relation, accessors, {
    _tableName: name,
    _schema: schema,
  });
  return relation as Table<TableName, Columns>;
}
