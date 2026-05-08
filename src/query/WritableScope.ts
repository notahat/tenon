// A where-narrowed scope on a base table that can build a DELETE or
// UPDATE. Returned by `Table.where(predicate)`; carries `.where`
// (chains and stays in scope), `.delete()` (consumes the accumulated
// predicates to build a DeleteNode), and `.update(attrs)` (consumes
// them plus a SET attrs object to build an UpdateNode).
//
// Extending Relation gives the scope all the read-side operators for
// free, but only `.where` is overridden to keep the scope alive —
// `.order`, `.limit`, `.project`, `.innerJoin` widen back to plain
// Relation, which has neither `.delete` nor `.update`. That mirrors
// Postgres: DELETE / UPDATE accept WHERE and RETURNING but not
// ORDER / LIMIT / PROJECT / JOIN in this iteration.
//
// Out of scope: SQL emission (src/sql/serialise.ts → deleteToSql,
// updateToSql); the Rails-style insert-chain (deferred to v1.9; uses
// an analogous `InsertableScope` with a predicate-to-attrs extractor).

import { deleteNode } from "../ast/delete.js";
import type { ExpressionNode } from "../ast/expression.js";
import { parameter } from "../ast/expression.js";
import type { RelationNode, TableRef } from "../ast/relation.js";
import { where as whereNode } from "../ast/relation.js";
import { updateAssignment, updateNode } from "../ast/update.js";
import type { ColumnsShape } from "../schema-runtime/columnType.js";
import { Delete } from "./Delete.js";
import type { Expression } from "./Expression.js";
import { Relation } from "./Relation.js";
import type { ForeignKeyTuple, UpdatableAttrs } from "./types.js";
import { Update } from "./Update.js";

export class WritableScope<
  TableName extends string,
  Columns extends ColumnsShape,
  FKs extends ForeignKeyTuple = readonly [],
> extends Relation<Columns, FKs> {
  // Phantom: lets the type system distinguish a WritableScope from a
  // plain Relation at use sites. Never read at runtime.
  declare readonly _tableName: TableName;

  constructor(
    node: RelationNode,
    private readonly target: TableRef,
  ) {
    super(node);
  }

  /**
   * Narrow this scope further. Like Relation.where but returns the
   * scope so `.delete` stays available across chained predicates.
   */
  override where(
    predicate: Expression<boolean>,
  ): WritableScope<TableName, Columns, FKs> {
    return new WritableScope<TableName, Columns, FKs>(
      whereNode(this.node, predicate.node),
      this.target,
    );
  }

  /**
   * Build a DELETE statement from the predicates accumulated by this
   * scope. The returned Delete carries `allowEmptyPredicates: false`,
   * so calling `.delete()` on a scope built without any `.where`
   * narrowing (which today is impossible — `Table.where` is the only
   * scope constructor) would still throw at serialisation time.
   */
  delete(): Delete<Columns, null> {
    const predicates = collectWherePredicates(this.node);
    return new Delete<Columns, null>(
      deleteNode({
        target: this.target,
        predicates,
        allowEmptyPredicates: false,
      }),
    );
  }

  /**
   * Build an UPDATE statement using the accumulated predicates and the
   * supplied SET attrs. Iteration order on `attrs` is preserved (per
   * ES2015+ object-key order) so the emitted SQL is deterministic. The
   * serialiser refuses to emit an UPDATE with no assignments — passing
   * `{}` here typechecks but throws at run time.
   */
  update(attrs: UpdatableAttrs<Columns>): Update<Columns, null> {
    const predicates = collectWherePredicates(this.node);
    const assignments = Object.entries(attrs as Record<string, unknown>).map(
      ([columnName, value]) => updateAssignment(columnName, parameter(value)),
    );
    return new Update<Columns, null>(
      updateNode({
        target: this.target,
        assignments,
        predicates,
      }),
    );
  }
}

/**
 * Walk a Where-chain rooted at a TableRef and return the predicates in
 * source order. The two construction sites — `Table.where` and
 * `WritableScope.where` — both guarantee the wrapped node is a
 * Where-chain over a TableRef, so the walk always terminates cleanly.
 */
function collectWherePredicates(node: RelationNode): readonly ExpressionNode[] {
  const predicates: ExpressionNode[] = [];
  let current: RelationNode = node;
  while (current.kind === "Where") {
    predicates.unshift(current.predicate);
    current = current.source;
  }
  return predicates;
}
