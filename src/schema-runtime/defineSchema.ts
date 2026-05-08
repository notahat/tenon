// Wires association accessors onto the SingleRow values produced by
// each Table's `find`. Takes a record of Tables, builds a lookup map
// keyed by `${schema}.${physicalName}`, and overrides each Table's
// `find` to merge in has-many (and, in step 4, belongs-to) accessors
// computed from the FK metadata that's already on every Table.
//
// The input Tables are mutated in place at runtime (only their `find`
// methods are replaced). The returned bag is the same input record,
// re-typed as `WiredSchema<S>` so each Table's `find` reports the
// wider SingleRow type with accessors merged in.
//
// Out of scope: belongs-to wiring (added in step 4 of v1.11);
// type-level association map (src/query/types.ts).

import { binaryOp, columnRef, parameter } from "../ast/expression.js";
import {
  tableRef as tableRefNode,
  where as whereNode,
} from "../ast/relation.js";
import { hasManyAccessorName } from "../query/accessor-naming.js";
import { Relation } from "../query/Relation.js";
import { SingleRow } from "../query/SingleRow.js";
import type {
  ForeignKeyTuple,
  HasManyAccessors,
  TableShape,
} from "../query/types.js";
import type { ColumnsShape } from "./columnType.js";
import type { ForeignKey } from "./foreignKey.js";

/** Loose runtime type for any defined Table; only fields we read are listed. */
interface AnyTableRuntime extends TableShape {
  find?: (id: unknown) => SingleRow<ColumnsShape>;
}

/**
 * The wired form of a schema bag: each input Table's `find` reports
 * a SingleRow intersected with the type-level association map. Tables
 * without `find` (composite or absent PK) pass through unchanged.
 */
export type WiredSchema<S extends Record<string, TableShape>> = {
  [K in keyof S]: WiredTable<S[K], S>;
};

/**
 * A single Table re-typed so `find` returns a SingleRow with
 * association accessors. The original `find` (if any) is stripped via
 * `Omit` and replaced; intersecting two `find` signatures returning
 * different SingleRow shapes would collapse to the narrower one and
 * the accessors would be invisible at use sites.
 */
export type WiredTable<
  T extends TableShape,
  S extends Record<string, TableShape>,
> = Omit<T, "find"> & WiredFind<T, S>;

/**
 * The `find` member contributed by `WiredTable`. Resolves to an empty
 * record when the table has no single-column primary key, so the
 * Omit-then-intersect path doesn't accidentally re-introduce a method
 * we already removed.
 */
type WiredFind<T extends TableShape, S extends Record<string, TableShape>> =
  T extends {
    _columns: infer C extends ColumnsShape;
    _primaryKey: { readonly columns: readonly [infer Col extends string] };
  }
    ? Col extends keyof C
      ? {
          /**
           * Look up a row by its primary key. The returned SingleRow
           * carries association accessors derived from the FK metadata
           * across the schema bag.
           */
          find(id: C[Col]["_tsType"]): SingleRow<C> & HasManyAccessors<T, S>;
        }
      : Record<never, never>
    : Record<never, never>;

/**
 * Wire association accessors onto each Table's `find` result. The
 * input record is mutated in place (each Table's `find` is replaced)
 * and returned, re-typed to expose the wired shape.
 */
export function defineSchema<const S extends Record<string, TableShape>>(
  tables: S,
): WiredSchema<S> {
  for (const table of Object.values(tables)) {
    wireTable(table as AnyTableRuntime, tables);
  }
  // The cast is through `unknown` because Omit-then-intersect makes
  // `WiredSchema<S>` structurally distinct from `S`. The runtime
  // mutation above installs the wired `find` on every table; the
  // returned bag is the same record, re-typed to expose it.
  return tables as unknown as WiredSchema<S>;
}

/**
 * Replace `table.find` so its returned SingleRow carries the
 * association accessors. Tables without `find` (no PK or composite
 * PK) are left untouched.
 */
function wireTable(
  table: AnyTableRuntime,
  allTables: Record<string, TableShape>,
): void {
  if (table.find === undefined) return;
  const originalFind = table.find.bind(table);
  table.find = function wiredFind(id: unknown): SingleRow<ColumnsShape> {
    const singleRow = originalFind(id);
    Object.assign(singleRow, buildHasManyAccessors(table, id, allTables));
    return singleRow;
  };
}

/**
 * Compute the has-many accessors for `parent.find(id)` as a record of
 * `Relation` values keyed by accessor name. For each other table in
 * the schema:
 *   - find single-column FKs pointing at `parent`;
 *   - skip self-references and accessor-name collisions with parent
 *     columns;
 *   - if exactly one FK matches, build the Relation with that FK's
 *     predicate baked in;
 *   - if more than one FK matches, skip at runtime (the type-level
 *     `AmbiguousHasManyBrand` covers the user-facing error path).
 */
function buildHasManyAccessors(
  parent: TableShape,
  parentId: unknown,
  allTables: Record<string, TableShape>,
): Record<string, Relation<ColumnsShape, ForeignKeyTuple>> {
  const accessors: Record<string, Relation<ColumnsShape, ForeignKeyTuple>> = {};
  for (const child of Object.values(allTables)) {
    if (samePhysicalTable(parent, child)) continue;
    const matches = singleColumnFksPointingAt(child._foreignKeys, parent);
    if (matches.length !== 1) continue;
    const accessorName = hasManyAccessorName(child._physicalName);
    if (parent._columnNames.includes(accessorName)) continue;
    accessors[accessorName] = buildHasManyRelation(
      child,
      matches[0]!,
      parentId,
    );
  }
  return accessors;
}

/**
 * Filter an FK list to single-column FKs whose referenced (schema,
 * name) matches the target. Composite FKs are skipped to mirror the
 * type-level `FkMatches` filter.
 */
function singleColumnFksPointingAt(
  foreignKeys: readonly ForeignKey[],
  target: TableShape,
): ForeignKey[] {
  const matches: ForeignKey[] = [];
  for (const fk of foreignKeys) {
    if (fk.columns.length !== 1) continue;
    if (fk.referencedSchema !== target._schema) continue;
    if (fk.referencedTable !== target._physicalName) continue;
    matches.push(fk);
  }
  return matches;
}

/** Two TableShapes target the same physical (schema, name) pair. */
function samePhysicalTable(left: TableShape, right: TableShape): boolean {
  return (
    left._schema === right._schema &&
    left._physicalName === right._physicalName
  );
}

/**
 * Build a `Relation<C[\"_columns\"]>` whose underlying SQL is
 * `SELECT * FROM child WHERE child.fkColumn = $parentId`. No join is
 * needed: we already know the parent id (from `find`), so the FK
 * column comparison can use it directly.
 */
function buildHasManyRelation(
  child: TableShape,
  fk: ForeignKey,
  parentId: unknown,
): Relation<ColumnsShape, ForeignKeyTuple> {
  const childRef = tableRefNode({
    schema: child._schema,
    name: child._physicalName,
    foreignKeys: child._foreignKeys,
  });
  const fkColumn = fk.columns[0]!;
  const predicate = binaryOp(
    "=",
    columnRef({ tableAlias: child._physicalName, column: fkColumn }),
    parameter(parentId),
  );
  return new Relation(whereNode(childRef, predicate));
}
