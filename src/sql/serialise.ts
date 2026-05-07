// AST -> SQL serialiser.
//
// Pure: takes a RelationNode (SELECT) or InsertNode tree, returns
// { text, params }. The text is parameterised SQL using $1, $2, ...
// placeholders compatible with node-postgres. The params array is in
// the order the placeholders appear in the text.
//
// Strategy: walk the relation tree once to collect clauses (FROM,
// WHEREs, ORDER BY terms, LIMIT, OFFSET), then emit them in canonical
// SQL order. Expressions are emitted recursively, threading
// parameters through a single EmitContext so placeholder numbering is
// always left-to-right and tree transforms never need to renumber.
// `insertToSql` shares the same EmitContext and `emitExpression`, so
// parameter numbering is consistent for the (eventual) case where an
// INSERT carries parameter-bearing expressions.
//
// Out of scope: query execution (src/executor/...); AST construction
// (src/ast/...); fluent wrappers (src/query/...).

import type { ExpressionNode } from "../ast/expression.js";
import type { InsertNode } from "../ast/insert.js";
import type {
  OrderTerm,
  ProjectionItem,
  RelationNode,
  TableRef,
} from "../ast/relation.js";
import { quoteIdent } from "./identifier.js";
import { binarySql, unaryPrefixSql, unarySuffixSql } from "./operators.js";

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
    case "InnerJoin":
      // Joins are unshifted so the deepest (leftmost) join in the
      // source tree emits first, matching the user's chaining order:
      // a.innerJoin(b).innerJoin(c) emits `a JOIN b JOIN c`.
      clauses.joins.unshift({
        kind: "inner",
        right: node.right,
        on: node.on,
      });
      collect(node.source, clauses);
      return;
  }
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
      return `(${unaryPrefixSql(node.operator)}${operand}${unarySuffixSql(
        node.operator,
      )})`;
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
