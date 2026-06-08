// AST -> SQL serialiser.
//
// Pure: takes a RelationNode (SELECT), InsertNode, UpdateNode, or
// DeleteNode tree, returns { text, params }. The text is parameterised
// SQL using $1, $2, ... placeholders compatible with node-postgres. The
// params array is in the order the placeholders appear in the text.
//
// Strategy: walk the relation tree once to collect clauses (FROM,
// WHEREs, ORDER BY terms, LIMIT, OFFSET), then emit them in canonical
// SQL order. Expressions are emitted recursively, threading
// parameters through a single EmitContext so placeholder numbering is
// always left-to-right and tree transforms never need to renumber.
// `insertToSql`, `updateToSql`, and `deleteToSql` share the same
// EmitContext and helpers, so parameter numbering is consistent across
// all four statement categories.
//
// Out of scope: query execution (src/executor/...); AST construction
// (src/ast/...); fluent wrappers (src/query/...).

import type { DeleteNode } from "../ast/delete.js";
import type { ExpressionNode } from "../ast/expression.js";
import { binaryOp, columnRef } from "../ast/expression.js";
import type { InsertNode } from "../ast/insert.js";
import type {
  OrderTerm,
  ProjectionItem,
  RelationNode,
  TableRef,
} from "../ast/relation.js";
import type { UpdateAssignment, UpdateNode } from "../ast/update.js";
import { quoteIdent } from "./identifier.js";
import { binarySql, unaryFix } from "./operators.js";

/** A serialised SQL statement plus its bound parameters. */
export interface CompiledQuery {
  readonly text: string;
  readonly params: readonly unknown[];
}

/** Serialise a relation tree to a parameterised SQL SELECT. */
export function relationToSql(node: RelationNode): CompiledQuery {
  const context: EmitContext = { params: [] };
  const text = emitSelect(node, context);
  return { text, params: context.params };
}

/** Serialise an Insert tree to a parameterised SQL INSERT. */
export function insertToSql(node: InsertNode): CompiledQuery {
  const context: EmitContext = { params: [] };
  const text = emitInsert(node, context);
  return { text, params: context.params };
}

/** Serialise an Update tree to a parameterised SQL UPDATE. */
export function updateToSql(node: UpdateNode): CompiledQuery {
  const context: EmitContext = { params: [] };
  const text = emitUpdate(node, context);
  return { text, params: context.params };
}

/** Serialise a Delete tree to a parameterised SQL DELETE. */
export function deleteToSql(node: DeleteNode): CompiledQuery {
  const context: EmitContext = { params: [] };
  const text = emitDelete(node, context);
  return { text, params: context.params };
}

/**
 * Mutable accumulator for parameter values during a single
 * serialisation. The mutation is contained to one top-level call;
 * relationToSql is externally pure.
 */
interface EmitContext {
  readonly params: unknown[];
}

interface CollectedJoin {
  readonly kind: "inner";
  readonly right: TableRef;
  readonly on: ExpressionNode;
}

/** A candidate FK match for the inferred-ON path: which alias on
 * which side joins on which column. */
interface FkMatch {
  readonly leftAlias: string;
  readonly leftColumn: string;
  readonly rightAlias: string;
  readonly rightColumn: string;
}

interface CollectedClauses {
  table: TableRef | null;
  joins: CollectedJoin[];
  projectionItems: readonly ProjectionItem[] | null;
  predicates: ExpressionNode[];
  orderTerms: readonly OrderTerm[] | null;
  limit: number | null;
  offset: number | null;
}

/** Walk the relation tree and gather clauses for canonical-order emit. */
function collect(node: RelationNode, clauses: CollectedClauses): void {
  switch (node.kind) {
    case "TableRef":
      clauses.table = node;
      return;
    case "Project":
      // Outer wins: only set if not already set by an outer Project.
      if (clauses.projectionItems === null) {
        clauses.projectionItems = node.items;
      }
      collect(node.source, clauses);
      return;
    case "Where":
      // Predicates are unshifted so source-tree order matches the
      // user's chaining order: r.where(a).where(b) emits `a AND b`.
      clauses.predicates.unshift(node.predicate);
      collect(node.source, clauses);
      return;
    case "Order":
      // Outer wins: only set if not already set by an outer Order.
      if (clauses.orderTerms === null) clauses.orderTerms = node.terms;
      collect(node.source, clauses);
      return;
    case "Limit":
      if (clauses.limit === null) clauses.limit = node.count;
      collect(node.source, clauses);
      return;
    case "Offset":
      if (clauses.offset === null) clauses.offset = node.count;
      collect(node.source, clauses);
      return;
    case "InnerJoin": {
      // Joins are unshifted so the deepest (leftmost) join in the
      // source tree emits first, matching the user's chaining order:
      // a.innerJoin(b).innerJoin(c) emits `a JOIN b JOIN c`.
      const on = node.on ?? inferJoinPredicate(node.source, node.right);
      clauses.joins.unshift({ kind: "inner", right: node.right, on });
      collect(node.source, clauses);
      return;
    }
  }
}

/** Walk a relation subtree and collect every TableRef it contains. */
function collectTableRefs(node: RelationNode): readonly TableRef[] {
  const refs: TableRef[] = [];
  function visit(current: RelationNode): void {
    switch (current.kind) {
      case "TableRef":
        refs.push(current);
        return;
      case "Project":
      case "Where":
      case "Order":
      case "Limit":
      case "Offset":
        visit(current.source);
        return;
      case "InnerJoin":
        visit(current.source);
        refs.push(current.right);
        return;
    }
  }
  visit(node);
  return refs;
}

/** Resolve a TableRef's column-qualifier alias (alias or physical name). */
function aliasOf(tableRef: TableRef): string {
  return tableRef.alias ?? tableRef.name;
}

/**
 * Infer the ON predicate for a join by matching FK metadata between
 * the source subtree and the right TableRef. The predicate is built
 * from the unique single-column FK that connects the two sides;
 * composite FKs and self-joins are ignored. Throws if zero or more
 * than one FK matches. The type system catches those same cases as
 * brands that surface at db.run time, so in typed code these throws
 * are a defensive backstop.
 */
function inferJoinPredicate(
  source: RelationNode,
  right: TableRef,
): ExpressionNode {
  const sourceTables = collectTableRefs(source);
  const matches: FkMatch[] = [];
  let selfJoin = false;
  for (const sourceTable of sourceTables) {
    if (samePhysicalTable(sourceTable, right)) {
      selfJoin = true;
      continue;
    }
    matches.push(...fkMatchesPointing(sourceTable, right));
    matches.push(...fkMatchesPointing(right, sourceTable));
  }
  if (matches.length === 0) {
    if (selfJoin) {
      throw new Error(
        "Cannot infer ON predicate for a self-join; pass an explicit .on(...) predicate.",
      );
    }
    throw new Error(
      `tenon: cannot infer join predicate; no foreign key connects ${right.name} ` +
        `with the joined source. Pass an explicit .on(...) predicate.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `tenon: cannot infer join predicate; ambiguous foreign keys between ${right.name} ` +
        `and the joined source. Pass an explicit .on(...) predicate.`,
    );
  }
  const match = matches[0]!;
  return binaryOp(
    "=",
    columnRef({ tableAlias: match.leftAlias, column: match.leftColumn }),
    columnRef({ tableAlias: match.rightAlias, column: match.rightColumn }),
  );
}

/** Single-column FKs on `from` that reference `to`, as FkMatch tuples. */
function fkMatchesPointing(from: TableRef, to: TableRef): FkMatch[] {
  const matches: FkMatch[] = [];
  for (const fk of from.foreignKeys) {
    if (fk.columns.length !== 1) continue;
    if (fk.referencedSchema !== to.schema) continue;
    if (fk.referencedTable !== to.name) continue;
    matches.push({
      leftAlias: aliasOf(from),
      leftColumn: fk.columns[0]!,
      rightAlias: aliasOf(to),
      rightColumn: fk.referencedColumns[0]!,
    });
  }
  return matches;
}

/** True when two TableRefs target the same physical (schema, name). */
function samePhysicalTable(left: TableRef, right: TableRef): boolean {
  return left.schema === right.schema && left.name === right.name;
}

/** Build the canonical SELECT string from a relation tree. */
function emitSelect(node: RelationNode, context: EmitContext): string {
  const clauses: CollectedClauses = {
    table: null,
    joins: [],
    projectionItems: null,
    predicates: [],
    orderTerms: null,
    limit: null,
    offset: null,
  };
  collect(node, clauses);
  if (clauses.table === null) {
    throw new Error("Relation tree has no source table.");
  }

  const selectList = emitSelectList(clauses.projectionItems, context);
  const parts: string[] = [
    `SELECT ${selectList} FROM ${emitTableRef(clauses.table)}`,
  ];
  for (const join of clauses.joins) {
    parts.push(emitJoin(join, context));
  }
  if (clauses.predicates.length > 0) {
    parts.push(`WHERE ${emitPredicates(clauses.predicates, context)}`);
  }
  if (clauses.orderTerms !== null && clauses.orderTerms.length > 0) {
    parts.push(`ORDER BY ${emitOrderTerms(clauses.orderTerms, context)}`);
  }
  if (clauses.limit !== null) {
    parts.push(`LIMIT ${clauses.limit}`);
  }
  if (clauses.offset !== null) {
    parts.push(`OFFSET ${clauses.offset}`);
  }
  return parts.join(" ");
}

/**
 * Emit the SELECT list. With no projection, defaults to `*`. With a
 * projection, each item becomes `<expr> AS "<outputName>"`, omitting
 * the AS when the output name matches a bare column reference.
 */
function emitSelectList(
  items: readonly ProjectionItem[] | null,
  context: EmitContext,
): string {
  if (items === null || items.length === 0) {
    return "*";
  }
  return items.map((item) => emitProjectionItem(item, context)).join(", ");
}

/** Emit a single projection item, with AS only when it would rename. */
function emitProjectionItem(
  item: ProjectionItem,
  context: EmitContext,
): string {
  const expression = emitExpression(item.expression, context);
  if (
    item.expression.kind === "ColumnRef" &&
    item.expression.column === item.outputName
  ) {
    return expression;
  }
  return `${expression} AS ${quoteIdent(item.outputName)}`;
}

/** Emit a single join clause: `INNER JOIN <table> ON <expr>`. */
function emitJoin(join: CollectedJoin, context: EmitContext): string {
  return `INNER JOIN ${emitTableRef(join.right)} ON ${emitExpression(join.on, context)}`;
}

/** Emit a TableRef as `"schema"."name"` plus an optional `AS "alias"`. */
function emitTableRef(node: TableRef): string {
  const qualified = `${quoteIdent(node.schema)}.${quoteIdent(node.name)}`;
  if (node.alias === null || node.alias === node.name) {
    return qualified;
  }
  return `${qualified} AS ${quoteIdent(node.alias)}`;
}

/** Emit a list of predicates joined by AND (parenthesised individually). */
function emitPredicates(
  predicates: readonly ExpressionNode[],
  context: EmitContext,
): string {
  return predicates
    .map((predicate) => emitExpression(predicate, context))
    .join(" AND ");
}

/** Emit an ORDER BY list as comma-separated `<expr> ASC|DESC` terms. */
function emitOrderTerms(
  terms: readonly OrderTerm[],
  context: EmitContext,
): string {
  return terms
    .map(
      (term) =>
        `${emitExpression(term.expression, context)} ${term.direction.toUpperCase()}`,
    )
    .join(", ");
}

/**
 * Build an INSERT statement: `INSERT INTO "schema"."name" (cols)
 * VALUES (params)` with an optional `RETURNING` tail. The target's
 * alias is intentionally dropped — INSERT does not need to qualify
 * the target, and aliasing it would only complicate the SQL without
 * changing semantics. With an empty column-values list, emits
 * `DEFAULT VALUES` (valid only when every column has a default;
 * Postgres surfaces the right error otherwise).
 */
function emitInsert(node: InsertNode, context: EmitContext): string {
  const target = `${quoteIdent(node.target.schema)}.${quoteIdent(node.target.name)}`;
  const head =
    node.columnValues.length === 0
      ? `INSERT INTO ${target} DEFAULT VALUES`
      : `INSERT INTO ${target} (${emitInsertColumns(node.columnValues)}) ` +
        `VALUES (${emitInsertValues(node.columnValues, context)})`;
  if (node.returning === null) {
    return head;
  }
  return `${head} RETURNING ${emitSelectList(node.returning, context)}`;
}

/** Emit the parenthesised column list for an INSERT. */
function emitInsertColumns(
  columnValues: readonly InsertNode["columnValues"][number][],
): string {
  return columnValues
    .map((columnValue) => quoteIdent(columnValue.column))
    .join(", ");
}

/** Emit the parenthesised VALUES list for an INSERT. */
function emitInsertValues(
  columnValues: readonly InsertNode["columnValues"][number][],
  context: EmitContext,
): string {
  return columnValues
    .map((columnValue) => emitExpression(columnValue.value, context))
    .join(", ");
}

/**
 * Build an UPDATE statement: `UPDATE "schema"."name" [AS "alias"] SET
 * <assignments> WHERE <predicates> [RETURNING ...]`. Like DELETE the
 * target's alias is preserved on emit — predicates qualify columns by
 * the same alias.
 *
 * Throws if the assignment list or the predicate list is empty.
 * Neither is reachable from the public surface (the only construction
 * sites — `WritableScope.update` and `WritableSingleRow.update` —
 * supply at least one of each) so the guards are purely defensive
 * against direct AST construction.
 */
function emitUpdate(node: UpdateNode, context: EmitContext): string {
  if (node.assignments.length === 0) {
    throw new Error(
      "UPDATE without any SET assignments is forbidden. " +
        "Pass at least one column to update(...).",
    );
  }
  if (node.predicates.length === 0) {
    throw new Error(
      "UPDATE without a WHERE clause is forbidden. " +
        "Narrow the target with .where(...) or .find(id).",
    );
  }
  const target = emitTableRef(node.target);
  const assignments = node.assignments
    .map((assignment) => emitAssignment(assignment, context))
    .join(", ");
  const where = ` WHERE ${emitPredicates(node.predicates, context)}`;
  const returning =
    node.returning === null
      ? ""
      : ` RETURNING ${emitSelectList(node.returning, context)}`;
  return `UPDATE ${target} SET ${assignments}${where}${returning}`;
}

/** Emit a single assignment as `"column" = <expr>`. */
function emitAssignment(
  assignment: UpdateAssignment,
  context: EmitContext,
): string {
  return `${quoteIdent(assignment.column)} = ${emitExpression(assignment.value, context)}`;
}

/**
 * Build a DELETE statement: `DELETE FROM "schema"."name" [AS "alias"]
 * [WHERE ...] [RETURNING ...]`. Unlike INSERT, the target's alias is
 * preserved on emit — predicates qualify columns by the same alias, so
 * dropping it would produce broken SQL when the user calls
 * `Table.as(...)` before deleting.
 *
 * Throws if the predicate list is empty and `allowEmptyPredicates` is
 * off. Only `Table.deleteAll()` flips the flag on; `Table.delete()`
 * leaves it off so an accidental `db.run(users.delete())` fails before
 * a round-trip.
 */
function emitDelete(node: DeleteNode, context: EmitContext): string {
  if (node.predicates.length === 0 && !node.allowEmptyPredicates) {
    throw new Error(
      "DELETE without a WHERE clause is forbidden. " +
        "Call Table.deleteAll() if you really mean to wipe every row.",
    );
  }
  const target = emitTableRef(node.target);
  const where =
    node.predicates.length > 0
      ? ` WHERE ${emitPredicates(node.predicates, context)}`
      : "";
  const returning =
    node.returning === null
      ? ""
      : ` RETURNING ${emitSelectList(node.returning, context)}`;
  return `DELETE FROM ${target}${where}${returning}`;
}

/** Recursively emit an expression node, appending any parameters. */
function emitExpression(node: ExpressionNode, context: EmitContext): string {
  switch (node.kind) {
    case "ColumnRef":
      return `${quoteIdent(node.tableAlias)}.${quoteIdent(node.column)}`;
    case "Parameter":
      context.params.push(node.value);
      return `$${context.params.length}`;
    case "BinaryOp": {
      const left = emitExpression(node.left, context);
      const right = emitExpression(node.right, context);
      return `(${left} ${binarySql(node.operator)} ${right})`;
    }
    case "UnaryOp": {
      const operand = emitExpression(node.operand, context);
      const { prefix, suffix } = unaryFix(node.operator);
      return `(${prefix}${operand}${suffix})`;
    }
    case "InList": {
      const operand = emitExpression(node.operand, context);
      const values = node.values
        .map((value) => emitExpression(value, context))
        .join(", ");
      return `(${operand} IN (${values}))`;
    }
  }
}
