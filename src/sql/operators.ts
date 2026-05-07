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

const UNARY_PREFIX: Readonly<Record<UnaryOperator, string>> = {
  NOT: "NOT ",
  "IS NULL": "",
  "IS NOT NULL": "",
};

const UNARY_SUFFIX: Readonly<Record<UnaryOperator, string>> = {
  NOT: "",
  "IS NULL": " IS NULL",
  "IS NOT NULL": " IS NOT NULL",
};

/** SQL fragment for a binary operator (no surrounding whitespace). */
export function binarySql(operator: BinaryOperator): string {
  return BINARY_SQL[operator];
}

/** Prefix to emit before a unary operand, e.g. `"NOT "` or `""`. */
export function unaryPrefixSql(operator: UnaryOperator): string {
  return UNARY_PREFIX[operator];
}

/** Suffix to emit after a unary operand, e.g. `" IS NULL"` or `""`. */
export function unarySuffixSql(operator: UnaryOperator): string {
  return UNARY_SUFFIX[operator];
}
