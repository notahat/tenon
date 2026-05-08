// AST node for an UPDATE statement.
//
// Sibling to RelationNode, InsertNode, and DeleteNode rather than a
// member of the relation tree: the SELECT serialiser, the join
// machinery, and the duplicate-column brand stay focused on relations.
// The fluent surface (WritableScope.update, WritableSingleRow.update,
// Update.returning) builds these nodes; the SQL serialiser
// (`updateToSql`) consumes them.
//
// The serialiser refuses to emit nodes with an empty assignment list or
// an empty predicate list. Neither is reachable from the public surface
// (the only construction sites supply at least one of each) so the
// guards are purely defensive against direct AST construction.
//
// Out of scope: SQL serialisation (src/sql/serialise.ts); fluent
// wrappers (src/query/Update.ts, src/query/WritableScope.ts,
// src/query/SingleRow.ts); UPDATE ... FROM (multi-table update),
// deferred to a later iteration.

import type { ExpressionNode } from "./expression.js";
import type { ProjectionItem, TableRef } from "./relation.js";

/**
 * A single (column, value) SET assignment for an UPDATE. The column
 * name is the physical column on the target table; the value is an
 * expression node, currently always a Parameter wrapping a runtime
 * value.
 */
export interface UpdateAssignment {
  readonly column: string;
  readonly value: ExpressionNode;
}

/**
 * An UPDATE statement targeting a single base table. Assignments are
 * emitted in array order (preserving the user's object-key order). The
 * predicate list is AND-ed at emit time. The optional RETURNING clause
 * reuses `ProjectionItem`, the same shape used in SELECT projections.
 */
export interface UpdateNode {
  readonly kind: "Update";
  readonly target: TableRef;
  readonly assignments: readonly UpdateAssignment[];
  readonly predicates: readonly ExpressionNode[];
  readonly returning: readonly ProjectionItem[] | null;
}

/** Build an UpdateAssignment. Pure. */
export function updateAssignment(
  column: string,
  value: ExpressionNode,
): UpdateAssignment {
  return { column, value };
}

/** Build an UpdateNode. Pure. */
export function updateNode(args: {
  readonly target: TableRef;
  readonly assignments: readonly UpdateAssignment[];
  readonly predicates: readonly ExpressionNode[];
  readonly returning?: readonly ProjectionItem[] | null;
}): UpdateNode {
  return {
    kind: "Update",
    target: args.target,
    assignments: args.assignments,
    predicates: args.predicates,
    returning: args.returning ?? null,
  };
}
