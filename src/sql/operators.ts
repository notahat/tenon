// SQL strings for the binary and unary operators carried by the AST.
// Kept separate from the serialiser so adding a new operator is one
// edit, not several.
//
// Out of scope: parenthesisation / precedence (handled by the
// serialiser); operator typing (handled in the AST module).

import type { BinaryOperator, UnaryOperator } from "../ast/expression.js";

const BINARY_SQL: Readonly<Record<BinaryOperator, string>> = {
  "=": "=",
  "<>": "<>",
  "<": "<",
  "<=": "<=",
  ">": ">",
  ">=": ">=",
  AND: "AND",
  OR: "OR",
};

interface UnaryFix {
  readonly prefix: string;
  readonly suffix: string;
}

const UNARY_FIX: Readonly<Record<UnaryOperator, UnaryFix>> = {
  NOT: { prefix: "NOT ", suffix: "" },
  "IS NULL": { prefix: "", suffix: " IS NULL" },
  "IS NOT NULL": { prefix: "", suffix: " IS NOT NULL" },
};

/** SQL fragment for a binary operator (no surrounding whitespace). */
export function binarySql(operator: BinaryOperator): string {
  return BINARY_SQL[operator];
}

/** Prefix and suffix to wrap around a unary operand. */
export function unaryFix(operator: UnaryOperator): UnaryFix {
  return UNARY_FIX[operator];
}
