// A where-narrowed scope on a base table that can build a DELETE.
// Returned by `Table.where(predicate)`; carries `.where` (chains and
// stays in scope) and `.delete()` (consumes the accumulated predicates
// to build a DeleteNode).
//
// Extending Relation gives the scope all the read-side operators for
// free, but only `.where` is overridden to keep the scope alive —
// `.order`, `.limit`, `.project`, `.innerJoin` widen back to plain
// Relation, which has no `.delete` method. That mirrors Postgres:
// DELETE accepts WHERE and RETURNING but not ORDER/LIMIT/PROJECT/JOIN
// in this iteration.
//
// Out of scope: SQL emission (src/sql/serialise.ts → deleteToSql);
// the Rails-style insert-chain (deferred to v1.9; uses an analogous
// `InsertableScope` with a predicate-to-attrs extractor).

import { deleteNode } from "../ast/delete.js";
import type { ExpressionNode } from "../ast/expression.js";
import type { RelationNode, TableRef } from "../ast/relation.js";
import { where as whereNode } from "../ast/relation.js";
import type { ColumnsShape } from "../schema-runtime/columnType.js";
import { Delete } from "./Delete.js";
import type { Expression } from "./Expression.js";
import { Relation } from "./Relation.js";
import type { ForeignKeyTuple } from "./types.js";

export class DeletableScope<
  TableName extends string,
  Columns extends ColumnsShape,
  FKs extends ForeignKeyTuple = readonly [],
> extends Relation<Columns, FKs> {
  // Phantom: lets the type system distinguish a DeletableScope from a
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
  ): DeletableScope<TableName, Columns, FKs> {
    return new DeletableScope<TableName, Columns, FKs>(
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
}

/**
 * Walk a Where-chain rooted at a TableRef and return the predicates
 * in source order. By construction the only nodes a DeletableScope
 * wraps are `Where(... Where(TableRef))`; a chain rooted at anything
 * else is a programmer error in this module.
 */
function collectWherePredicates(node: RelationNode): readonly ExpressionNode[] {
  const predicates: ExpressionNode[] = [];
  let current: RelationNode = node;
  while (current.kind === "Where") {
    predicates.unshift(current.predicate);
    current = current.source;
  }
  if (current.kind !== "TableRef") {
    throw new Error(
      "DeletableScope must wrap a Where-chain rooted at a TableRef.",
    );
  }
  return predicates;
}
