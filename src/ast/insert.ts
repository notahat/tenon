// AST node for an INSERT statement.
//
// An INSERT is a separate statement category from a SELECT and has its
// own top-level node type, sibling to RelationNode rather than a member
// of it: the SELECT serialiser, the join machinery, and the duplicate-
// column brand all stay focused on relations. The fluent surface
// (Table.insert, Insert.returning) builds these nodes; the SQL
// serialiser (`insertToSql`) consumes them.
//
// Out of scope: SQL serialisation (src/sql/serialise.ts); fluent
// wrappers (src/query/Insert.ts); UPDATE / DELETE / ON CONFLICT, all
// of which are deferred.

import type { ExpressionNode } from "./expression.js";
import type { ProjectionItem, TableRef } from "./relation.js";

/**
 * A single (column, value) pair contributing to an INSERT row. The
 * column name is the physical column on the target table; the value is
 * an expression node, currently always a Parameter wrapping a runtime
 * value.
 */
export interface InsertColumnValue {
  readonly column: string;
  readonly value: ExpressionNode;
}

/**
 * An INSERT statement targeting a single base table. The column-values
 * list is preserved in user-supplied order; serialisation emits both
 * the column list and the VALUES list in that same order so the user's
 * keys match the placeholders. The optional RETURNING clause reuses
 * `ProjectionItem`, the same shape used in SELECT projections.
 */
export interface InsertNode {
  readonly kind: "Insert";
  readonly target: TableRef;
  readonly columnValues: readonly InsertColumnValue[];
  readonly returning: readonly ProjectionItem[] | null;
}

/** Build an InsertColumnValue. Pure. */
export function insertColumnValue(
  column: string,
  value: ExpressionNode,
): InsertColumnValue {
  return { column, value };
}

/** Build an InsertNode. Pure. */
export function insertNode(args: {
  readonly target: TableRef;
  readonly columnValues: readonly InsertColumnValue[];
  readonly returning?: readonly ProjectionItem[] | null;
}): InsertNode {
  return {
    kind: "Insert",
    target: args.target,
    columnValues: args.columnValues,
    returning: args.returning ?? null,
  };
}
