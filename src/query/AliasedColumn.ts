// Wraps a Column reference together with a renamed output name. The
// only producer is `Column.as("name")`; consumers are projection lists,
// where the output name becomes a key in the projected row's static
// shape.
//
// Out of scope: SQL serialisation; aliasing of non-column scalar
// expressions, which is not yet supported and would need a separate
// aliased-expression wrapper.

import type { ExpressionNode } from "../ast/expression.js";
import type { ColumnType } from "../schema-runtime/columnType.js";

export class AliasedColumn<
  OutputName extends string,
  Type extends ColumnType<unknown, string, boolean, boolean, boolean>,
> {
  // Phantom: never read at runtime; flows the literal output-name and
  // column-type through projection inference.
  declare readonly _outputName: OutputName;
  declare readonly _type: Type;

  constructor(
    readonly node: ExpressionNode,
    readonly outputName: OutputName,
  ) {}
}
