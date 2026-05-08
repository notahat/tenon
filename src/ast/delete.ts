// AST node for a DELETE statement.
//
// Sibling to RelationNode and InsertNode rather than a member of the
// relation tree: the SELECT serialiser, the join machinery, and the
// duplicate-column brand stay focused on relations. The fluent surface
// (WritableScope.delete, Table.delete, Table.deleteAll,
// Delete.returning) builds these nodes; the SQL serialiser
// (`deleteToSql`) consumes them.
//
// `allowEmptyPredicates` is the explicit "I really want to wipe every
// row" flag. Only `Table.deleteAll()` produces a node with it set;
// `Table.delete()` produces a node with the flag off and an empty
// predicate list, which the serialiser refuses to emit.
//
// Out of scope: SQL serialisation (src/sql/serialise.ts); fluent
// wrappers (src/query/Delete.ts, src/query/WritableScope.ts);
// UPDATE / DELETE ... USING, both deferred.

import type { ExpressionNode } from "./expression.js";
import type { ProjectionItem, TableRef } from "./relation.js";

/**
 * A DELETE statement targeting a single base table. Predicates are
 * AND-ed in array order at emit time. The optional RETURNING clause
 * reuses `ProjectionItem`, the same shape used in SELECT projections.
 */
export interface DeleteNode {
  readonly kind: "Delete";
  readonly target: TableRef;
  readonly predicates: readonly ExpressionNode[];
  readonly allowEmptyPredicates: boolean;
  readonly returning: readonly ProjectionItem[] | null;
}

/** Build a DeleteNode. Pure. */
export function deleteNode(args: {
  readonly target: TableRef;
  readonly predicates?: readonly ExpressionNode[];
  readonly allowEmptyPredicates?: boolean;
  readonly returning?: readonly ProjectionItem[] | null;
}): DeleteNode {
  return {
    kind: "Delete",
    target: args.target,
    predicates: args.predicates ?? [],
    allowEmptyPredicates: args.allowEmptyPredicates ?? false,
    returning: args.returning ?? null,
  };
}
