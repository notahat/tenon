// Expression-level AST nodes.
//
// Expressions appear inside relation nodes (e.g. as a Where predicate
// or an Order term) and are emitted as parameterised SQL expressions
// by the serialiser. The set of node kinds is kept small on purpose;
// new comparator or operator forms should be modelled with the
// existing BinaryOp/UnaryOp shapes wherever possible.
//
// Out of scope: SQL serialisation (src/sql/serialise.ts), the fluent
// Column / Expression wrappers (src/query/...).

/** A reference to a column on a specific table alias. Always qualified. */
export interface ColumnRef {
  readonly kind: "ColumnRef";
  readonly tableAlias: string;
  readonly column: string;
}

/**
 * A parameter slot. Carries the value only; the placeholder index ($1,
 * $2, ...) is assigned by the serialiser at emit time, in left-to-right
 * order, so tree transforms never need to renumber.
 */
export interface Parameter {
  readonly kind: "Parameter";
  readonly value: unknown;
}

/** Comparison and logical binary operators supported by the AST. */
export type BinaryOperator =
  | "="
  | "<>"
  | "<"
  | "<="
  | ">"
  | ">="
  | "AND"
  | "OR";

/** Unary operators supported by the AST. */
export type UnaryOperator = "NOT" | "IS NULL" | "IS NOT NULL";

export interface BinaryOp {
  readonly kind: "BinaryOp";
  readonly operator: BinaryOperator;
  readonly left: ExpressionNode;
  readonly right: ExpressionNode;
}

export interface UnaryOp {
  readonly kind: "UnaryOp";
  readonly operator: UnaryOperator;
  readonly operand: ExpressionNode;
}

export interface InList {
  readonly kind: "InList";
  readonly operand: ExpressionNode;
  readonly values: readonly ExpressionNode[];
}

export type ExpressionNode =
  | ColumnRef
  | Parameter
  | BinaryOp
  | UnaryOp
  | InList;

/** Build a ColumnRef. Pure. */
export function columnRef(args: {
  readonly tableAlias: string;
  readonly column: string;
}): ColumnRef {
  return {
    kind: "ColumnRef",
    tableAlias: args.tableAlias,
    column: args.column,
  };
}

/** Build a Parameter from a runtime value. Pure. */
export function parameter(value: unknown): Parameter {
  return { kind: "Parameter", value };
}

/** Build a BinaryOp. Pure. */
export function binaryOp(
  operator: BinaryOperator,
  left: ExpressionNode,
  right: ExpressionNode,
): BinaryOp {
  return { kind: "BinaryOp", operator, left, right };
}

/** Build a UnaryOp. Pure. */
export function unaryOp(
  operator: UnaryOperator,
  operand: ExpressionNode,
): UnaryOp {
  return { kind: "UnaryOp", operator, operand };
}

/** Build an InList. Pure. */
export function inList(
  operand: ExpressionNode,
  values: readonly ExpressionNode[],
): InList {
  return { kind: "InList", operand, values };
}
