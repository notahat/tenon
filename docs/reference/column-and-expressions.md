# `Column`, `AliasedColumn`, `Expression`

The expression layer: column references, comparison operators,
and the boolean combinators on `Expression<boolean>`.

```ts
import { Column, AliasedColumn, Expression } from "@notahat/tenon";
```

Most users don't reference these classes directly — `defineTable`
exposes `Column` instances as properties of the table value, and
the comparators return `Expression` values you pass straight to
`where`, `on`, etc. The classes are exported so test code and
custom helpers can name them.

## `Column<TableName, Name, Type>`

A column reference. Carries three phantoms (`_tableName`,
`_columnName`, `_type`) and one runtime field (`tableAlias`,
`columnName`).

### Comparison operators

All produce `Expression<boolean>`. The right-hand side may be a
raw value (parameterised), another column of the same type, or
another `Expression`.

```ts
eq(other: ComparableTo<Type>): Expression<boolean>;   // =
neq(other: ComparableTo<Type>): Expression<boolean>;  // <>
lt(other: ComparableTo<Type>): Expression<boolean>;   // <
lte(other: ComparableTo<Type>): Expression<boolean>;  // <=
gt(other: ComparableTo<Type>): Expression<boolean>;   // >
gte(other: ComparableTo<Type>): Expression<boolean>;  // >=
```

### NULL checks

```ts
isNull(): Expression<boolean>;
isNotNull(): Expression<boolean>;
```

`.eq(null)` is rejected; SQL `=` does not behave as a NULL check.

### Membership

```ts
in(values: readonly ComparableTo<Type>[]): Expression<boolean>;
```

Emits `column IN (...)`. Each value is a parameter, column, or
expression. The list is at most as large as the SQL parameter
limit (`pg`'s default cap is 65535).

### Ordering

```ts
asc(): Ordering;
desc(): Ordering;
```

Build an [`Ordering`](ordering.md) for `relation.order(...)`.
NULLS FIRST / NULLS LAST is not yet supported.

### Renaming for projection

```ts
as<NewName extends string>(name: NewName): AliasedColumn<NewName, Type>;
```

Wrap this column with an output name. Use in `project(...)` and
`returning(...)` to control the resulting row shape.

## `AliasedColumn<OutputName, Type>`

Produced only by `column.as("name")`. The single use site is
projection lists; the alias becomes the key in the projected
row. Has no methods of its own.

## `Expression<TsResult>`

Wraps an expression-shaped AST node. The `TsResult` phantom is
the TypeScript type the expression evaluates to; for predicates
it's `boolean`.

### Boolean combinators

Available only when `TsResult extends boolean` (enforced by the
`this` parameter on each method):

```ts
and(this: Expression<boolean>, other: Expression<boolean>): Expression<boolean>;
or(this: Expression<boolean>, other: Expression<boolean>): Expression<boolean>;
not(this: Expression<boolean>): Expression<boolean>;
```

Multiple `.where(...)` calls AND together too — usually clearer
than chained `.and`.

## See also

- [Expressions guide](../guide/expressions.md).
- [`ComparableTo`](types.md#comparableto) for the right-hand-side
  type of every comparator.
