# Queries

This guide covers reading from a single table: choosing columns,
filtering rows, sorting, and paging. [Joins](joins.md) and
[writes](writes.md) build on the same operators and have their own
guides.

Every query starts from a table value imported from your generated
schema:

```ts
import { users } from "./schema";
```

Each operator below returns a new relation, so you chain them. Nothing
queries the database until you pass the result to `db.run(...)`, which
compiles it to SQL, runs it, and returns rows typed to match.

## Selecting columns

By default, a relation returns every column. The row type follows the
table, so nullable columns come back as `T | null`:

```ts
const rows = await db.run(users);
//    ^? Array<{ id: number; email: string; age: number | null }>
```

Use `project` to narrow to the columns you want. The row type narrows
with it:

```ts
const rows = await db.run(users.project(users.id, users.email));
//    ^? Array<{ id: number; email: string }>
```

Rename a column with `.as(...)`. The new name becomes the key in the
result:

```ts
const rows = await db.run(users.project(users.id.as("userId"), users.email));
//    ^? Array<{ userId: number; email: string }>
```

## Filtering

`where` takes a boolean expression built from a column and a
comparator:

```ts
const adults = await db.run(users.where(users.age.gte(18)));
```

The comparators are:

| Method         | SQL           | Meaning               |
| -------------- | ------------- | --------------------- |
| `.eq(value)`   | `=`           | Equal to              |
| `.neq(value)`  | `<>`          | Not equal to          |
| `.lt(value)`   | `<`           | Less than             |
| `.lte(value)`  | `<=`          | Less than or equal    |
| `.gt(value)`   | `>`           | Greater than          |
| `.gte(value)`  | `>=`          | Greater than or equal |
| `.in([...])`   | `IN`          | Member of a list      |
| `.isNull()`    | `IS NULL`     | Value is SQL NULL     |
| `.isNotNull()` | `IS NOT NULL` | Value is not SQL NULL |

SQL `=` never matches NULL, so use `.isNull()` and `.isNotNull()` for
NULL checks rather than `.eq(null)`.

Values you compare against are sent to Postgres as bound parameters,
never spliced into the SQL string, so there's no injection surface:

```ts
await db.run(users.where(users.id.in([1, 3])));
// WHERE ("users"."id" IN ($1, $2))   params: [1, 3]
```

A comparator can also take another column instead of a literal, which
compares the two columns row by row:

```ts
await db.run(posts.where(posts.author_id.eq(posts.id)));
```

Chaining `where` combines the predicates with `AND`, in the order you
wrote them:

```ts
await db.run(users.where(users.age.gte(18)).where(users.age.lt(65)));
// WHERE ("users"."age" >= $1) AND ("users"."age" < $2)
```

Chained `where` only ever joins with `AND`. For anything else, build a
single expression with the `.and()`, `.or()`, and `.not()` methods that
every boolean expression carries. `.or()` is the one chaining can't
express:

```ts
await db.run(users.where(users.age.lt(18).or(users.age.gte(65))));
// WHERE (("users"."age" < $1) OR ("users"."age" >= $2))
```

They nest, so you group conditions by where you call them. `.and()` and
`.or()` each join two expressions; `.not()` negates one:

```ts
await db.run(
  users.where(
    users.age
      .gte(18)
      .and(users.email.eq("a@example.com").or(users.email.eq("b@example.com"))),
  ),
);
// WHERE (("users"."age" >= $1)
//   AND (("users"."email" = $2) OR ("users"."email" = $3)))
```

## Sorting

Order the result with `.asc()` or `.desc()` on a column, passed to
`order`:

```ts
await db.run(users.order(users.email.asc()));
```

For a multi-column sort, pass every term to a single `order` call. The
terms apply left to right:

```ts
await db.run(users.order(users.age.desc(), users.email.asc()));
```

Calling `order` again does not add to the existing sort. The outermost
call wins and replaces the earlier terms, so put all the terms you want
in one call.

## Paging

`limit` caps the number of rows; `offset` skips rows before returning
the rest. They pair naturally for paging:

```ts
// The second page of 20.
await db.run(users.order(users.id.asc()).limit(20).offset(20));
```

## Combining operators

You can mix these in any order. Tenon reorders the clauses into valid
SQL when it serialises, so you chain them in whatever order reads best:

```ts
const page = await db.run(
  users
    .where(users.age.isNotNull())
    .order(users.age.desc())
    .project(users.id, users.age)
    .limit(10),
);
//    ^? Array<{ id: number; age: number | null }>
```

## Where to go next

- [Joins](joins.md): combining tables, with inferred or explicit `ON`.
- [Writes](writes.md): inserts, updates, and deletes.
- [Type mapping](type-mapping.md): how Postgres types become TypeScript
  types, and the nullable rules behind `age: number | null`.
- [The query pipeline](../internals/pipeline.md): what actually happens
  between a chained query and the rows you get back.
