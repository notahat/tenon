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
import type { JoinBuilder } from "../query/Relation.js";
import type { ForeignKeyTuple, InsertableAttrs } from "../query/types.js";
import type { ColumnType, ColumnsShape } from "./columnType.js";

/**
 * The shape of a defined table: a Relation with column accessors
 * merged in. The `Alias` parameter is the qualifier used in column
 * references; `Schema` and `PhysicalName` carry the table's literal
 * physical identity (preserved across `.as("alias")`) so the
 * type-level join-inference checks can detect self-joins by
 * comparing `(Schema, PhysicalName)` pairs.
 */
export type Table<
  Alias extends string,
  Columns extends ColumnsShape,
  FKs extends ForeignKeyTuple = readonly [],
  Schema extends string = string,
  PhysicalName extends string = string,
> = Omit<Relation<Columns, FKs>, "where" | "innerJoin"> &
  Readonly<{
    _tableName: Alias;
    _schema: Schema;
    _physicalName: PhysicalName;
    _foreignKeys: FKs;
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
     * one query (self-joins, plus column-name disambiguation). FK
     * metadata is preserved because FKs reference physical names.
     */
    as<NewAlias extends string>(
      alias: NewAlias,
    ): Table<NewAlias, Columns, FKs, Schema, PhysicalName>;
    /**
     * Inner-join this table with another defined table. Captures the
     * literal physical (schema, name) of both sides so the resulting
     * JoinBuilder's merged-columns shape carries a self-join brand
     * when both sides are the same physical table. Override of
     * `Relation.innerJoin`; the loose Relation form (used when the
     * left side is a chained relation, not a Table) keeps the loose
     * generics that disable the brand.
     */
    innerJoin<
      RColumns extends ColumnsShape,
      RFKs extends ForeignKeyTuple = readonly [],
      RSchema extends string = string,
      RPhysicalName extends string = string,
    >(
      right: Relation<RColumns, RFKs> & {
        readonly _tableName: string;
        readonly _schema: RSchema;
        readonly _physicalName: RPhysicalName;
      },
    ): JoinBuilder<
      Columns,
      FKs,
      Schema,
      PhysicalName,
      RColumns,
      RFKs,
      RSchema,
      RPhysicalName
    >;
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
    where(predicate: Expression<boolean>): DeletableScope<Alias, Columns, FKs>;
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
 * table name itself; rename it for joins via `.as("u")`. The optional
 * `foreignKeys` argument records this table's outgoing FK
 * relationships, used by the fluent layer to infer ON predicates for
 * `innerJoin` calls that omit `.on(...)`.
 */
export function defineTable<
  TableName extends string,
  Schema extends string,
  Columns extends ColumnsShape,
  const FKs extends ForeignKeyTuple = readonly [],
>(
  schema: Schema,
  name: TableName,
  columns: Columns,
  foreignKeys: FKs = [] as unknown as FKs,
): Table<TableName, Columns, FKs, Schema, TableName> {
  return buildTable(schema, name, name, columns, foreignKeys) as Table<
    TableName,
    Columns,
    FKs,
    Schema,
    TableName
  >;
}

/**
 * Construct a Table for the given physical (schema, name) under the
 * given column-qualification alias. Shared between `defineTable` (where
 * the alias defaults to the table name) and `Table.as` (where the user
 * picks the alias). FK metadata is preserved unchanged across aliasing
 * because FKs reference *physical* table names, not aliases.
 */
function buildTable<
  Alias extends string,
  Schema extends string,
  PhysicalName extends string,
  Columns extends ColumnsShape,
  FKs extends ForeignKeyTuple,
>(
  schema: Schema,
  name: PhysicalName,
  alias: Alias,
  columns: Columns,
  foreignKeys: FKs,
): Table<Alias, Columns, FKs, Schema, PhysicalName> {
  const node =
    (alias as string) === (name as string)
      ? tableRef({ schema, name, foreignKeys })
      : tableRef({ schema, name, alias, foreignKeys });
  const relation = new Relation<Columns, FKs>(node);
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
    _physicalName: name,
    _foreignKeys: foreignKeys,
    as<NewAlias extends string>(
      newAlias: NewAlias,
    ): Table<NewAlias, Columns, FKs, Schema, PhysicalName> {
      return buildTable(schema, name, newAlias, columns, foreignKeys);
    },
    // No runtime override for `innerJoin`: it's inherited from
    // `Relation.prototype` via the `new Relation(node)` above. The
    // Table type intersects in a more specific signature so the
    // returned JoinBuilder carries the literal Schema /
    // PhysicalName generics that drive the FK-inference brand.
    insert(attrs: InsertableAttrs<Columns>): Insert<Columns, null> {
      const columnValues = Object.entries(attrs as Record<string, unknown>).map(
        ([columnName, value]) =>
          insertColumnValue(columnName, parameter(value)),
      );
      return new Insert<Columns, null>(
        insertNode({ target: node, columnValues }),
      );
    },
    where(predicate: Expression<boolean>): DeletableScope<Alias, Columns, FKs> {
      return new DeletableScope<Alias, Columns, FKs>(
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
  return relation as Table<Alias, Columns, FKs, Schema, PhysicalName>;
}
