# `scope`, `Scope`

Helper for writing reusable, composable relation transforms — the
Rails sense of "scope".

```ts
import { scope, type Scope } from "@notahat/tenon";
```

A scope is just a function from `Relation<Columns>` to
`Relation<Columns>`. Composition is ordinary function
application; no fluent dot-chain machinery is needed.

## Type

```ts
type Scope<Columns extends ColumnsShape> = (
  relation: Relation<Columns>,
) => Relation<Columns>;
```

Same column shape in, same column shape out.

## Function

```ts
function scope<Table extends Relation<ColumnsShape>>(
  table: Table,
  body: (relation: Relation<Table["_columns"]>) => Relation<Table["_columns"]>,
): Scope<Table["_columns"]>;
```

`scope` exists so the `body` can be written without an explicit
`Relation<Columns>` annotation. The `table` argument is purely a
type anchor — discarded at runtime — and the body closes over
whatever schema references it needs at the call site.

## Example

```ts
import { users } from "./schema";
import { scope } from "@notahat/tenon";

const active = scope(users, (relation) =>
  relation.where(users.active.eq(true)),
);

const recent = scope(users, (relation) =>
  relation.order(users.createdAt.desc()).limit(10),
);

await db.run(recent(active(users)));
```

Compose with ordinary function calls. `pipe` and friends from
your favourite functional library work too.

## What's not exposed

- Cross-table scopes (transforms whose columns shape differs from
  the input). The current `Scope` type is invariant on
  `Columns`.
- Runtime caching or memoisation of scope results.
