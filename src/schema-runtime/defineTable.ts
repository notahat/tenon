// Builds a runtime Table object from a schema declaration.
//
// Generated schema files call this once per table. The returned value
// exposes one Column per declared column; users (and later operators)
// reference columns directly: `users.id`, `users.email`, ...
//
// Out of scope: introspection / code generation (src/introspect/...);
// per-row TS types (those flow from the columns map's element types).

import { Column } from "../query/Column.js";
import type { ColumnType, ColumnsShape } from "./columnType.js";

/**
 * The shape of a defined table: each declared column maps to a
 * Column<TableName, ColumnName, Type> wrapper. The TableName literal
 * type is preserved so future joins can keep references qualified.
 */
export type Table<
  TableName extends string,
  Columns extends ColumnsShape,
> = TableMeta<TableName, Columns> & {
  readonly [Name in keyof Columns & string]: Column<
    TableName,
    Name,
    Columns[Name]
  >;
};

/** Internal metadata fields kept under reserved-ish keys. */
interface TableMeta<TableName extends string, Columns extends ColumnsShape> {
  readonly _tableName: TableName;
  readonly _schema: string;
  readonly _columns: Columns;
}

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
  const accessors: Record<
    string,
    Column<string, string, ColumnType<unknown, string, boolean>>
  > = {};
  for (const columnName of Object.keys(columns)) {
    accessors[columnName] = new Column(name, columnName);
  }
  const meta: TableMeta<TableName, Columns> = {
    _tableName: name,
    _schema: schema,
    _columns: columns,
  };
  return Object.freeze({ ...meta, ...accessors }) as Table<TableName, Columns>;
}
