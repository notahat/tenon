// Wraps an AST OrderTerm at the fluent layer so `relation.order(...)`
// can be typed to accept only ordering objects (produced by
// `column.asc()` / `column.desc()`) and reject bare columns or
// expressions, which could otherwise be silently dropped.
//
// Out of scope: SQL serialisation; NULLS FIRST / NULLS LAST nullability
// semantics, which are not yet supported.

import type { OrderTerm } from "../ast/relation.js";

export class Ordering {
  constructor(readonly node: OrderTerm) {}
}
