# `JoinBuilder<Left, Right>`

The two-step builder produced by `Relation.innerJoin(rightTable)`.

```ts
import { JoinBuilder } from "@notahat/tenon";
```

`Relation.innerJoin(...)` returns a `JoinBuilder`; the only
method it exposes is `.on(predicate)`. Splitting the join in two
ensures "forgot the ON clause" is a compile error rather than a
Cartesian product.

## `.on(predicate)`

```ts
on(predicate: Expression<boolean>): Relation<MergedColumns<Left, Right>>;
```

Complete the inner join with a boolean predicate. Predicates may
freely reference columns from either side, including those whose
names overlap.

If the merged columns shape has duplicates, the resulting
`Relation` carries a brand that is rejected at `Database.run`.
[`MergedColumns`](types.md#mergedcolumns) explains the brand and
how to fix it (`project` or `as`).

## Example

```ts
users
  .innerJoin(posts)
  .on(users.id.eq(posts.authorId))
  .where(posts.body.isNotNull())
  .project(users.email, posts.body.as("post"));
```

## See also

- [Joins guide](../guide/joins.md).
- [`Relation.innerJoin`](relation.md#innerjoinrighttable).
