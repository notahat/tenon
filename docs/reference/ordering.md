# `Ordering`

A typed ordering term passed to `Relation.order(...)`.

```ts
import { Ordering } from "@notahat/tenon";
```

Produced by `column.asc()` and `column.desc()`. Has no methods of
its own; the wrapping exists only so `relation.order(...)` can
accept "ordering objects" by type and reject bare columns or
expressions, which would otherwise be silently dropped.

## Example

```ts
users.order(users.active.desc(), users.email.asc());
```

NULLS FIRST / NULLS LAST is not yet supported; the default
Postgres ordering applies (`asc` puts NULLs last; `desc` puts
NULLs first).

## See also

- [`Relation.order`](relation.md).
- [`Column`](column-and-expressions.md#columntablename-name-type)
  for `.asc` / `.desc`.
