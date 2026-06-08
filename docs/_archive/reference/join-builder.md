# `JoinBuilder<Left, LFKs, LSchema, LName, Right, RFKs, RSchema, RName>`

The eight-generic builder produced by `Relation.innerJoin(rightTable)`.
Extends [`Relation`](relation.md), so the join is **runnable
directly** when an unambiguous foreign key connects the two
sides — the serialiser fills in the ON predicate from FK
metadata. Calling `.on(predicate)` returns a fresh `Relation`
with the explicit predicate baked in.

```ts
import { JoinBuilder } from "@notahat/tenon";
```

The eight generics carry both sides' column shapes, FK tuples,
and physical (schema, name) identities. The identity generics
let the type system compute the inference brand on the merged
columns shape — see [`MergedColumnsWithFkBrand`](types.md#mergedcolumnswithfkbrand).

## `.on(predicate)`

```ts
on(
  predicate: Expression<boolean>,
): Relation<MergedColumns<Left, Right>, MergedForeignKeys<LFKs, RFKs>>;
```

Complete the inner join with an explicit boolean predicate.
Predicates may freely reference columns from either side,
including those whose names overlap.

The returned `Relation` carries the plain
[`MergedColumns`](types.md#mergedcolumns) shape — no inference
brand — so an explicit `.on(...)` clears the missing /
ambiguous / self-join error a JoinBuilder would otherwise
surface. The duplicate-column brand on `MergedColumns` still
applies; project before `db.run(...)` if both sides share
column names.

## Running without `.on(...)`

When `tenon-generate` recorded a single-column foreign key
between the two sides, you can pass the JoinBuilder straight to
`db.run(...)`:

```ts
await db.run(posts.innerJoin(users).project(posts.body, users.email));
```

If the FK lookup is ambiguous, missing, or both sides resolve to
the same physical table, the merged-columns shape carries one of
three brands (`__tenonInferenceMissing`,
`__tenonInferenceAmbiguous`, `__tenonInferenceSelfJoin`) that
the run-site overload rejects. The error message names the
offending tables. See the [joins guide](../guide/joins.md#fk-inferred-on-predicates)
for examples.

## Example

```ts
// FK-inferred:
await db.run(posts.innerJoin(users).project(posts.body, users.email));

// Explicit override:
users
  .innerJoin(posts)
  .on(users.id.eq(posts.authorId))
  .where(posts.body.isNotNull())
  .project(users.email, posts.body.as("post"));
```

## See also

- [Joins guide](../guide/joins.md).
- [`Relation.innerJoin`](relation.md#innerjoinrighttable).
- [`MergedColumnsWithFkBrand`](types.md#mergedcolumnswithfkbrand).
