# The query pipeline

This document follows one query from the code you write to the rows you
get back. If you want to understand how tenon works internally, start
here. The other internals docs go deeper on individual stages.

We'll trace this query the whole way through:

```ts
db.run(
  posts
    .innerJoin(users)
    .where(posts.body.isNotNull())
    .project(users.email, posts.body.as("post")),
);
```

It's small but it touches everything: a join (whose `ON` clause tenon
infers), a filter, and a projection that renames a column.

There are two things happening at once, and it's worth separating them:

- **At runtime**, the chain builds a small tree of plain objects, the
  serialiser turns that tree into a SQL string, and the executor runs
  it. This is most of the document.
- **At the type level**, a parallel set of phantom types (types that
  exist only at compile time and carry no runtime value) tracks which
  columns exist and what they hold, so the result type is known and
  mistakes are caught when you compile. We cover that briefly at the
  end and in depth in [the type system](types.md).

## Building a tree

A `Relation` is a thin wrapper around one AST node. You can see the
whole class in `src/query/Relation.ts`; the runtime part is just:

```ts
class Relation<Columns, FKs> {
  constructor(readonly node: RelationNode) {}
  where(predicate) {
    return new Relation(whereNode(this.node, predicate.node));
  }
  // order, limit, offset, project, innerJoin: all the same shape
}
```

Every operator does the same thing: it builds a new AST node that wraps
the current `node`, and returns a new `Relation` around it. Nothing is
mutated, and each step adds one layer.

So the chain builds up one node at a time. Starting from `posts` (a
`Relation` wrapping a `TableRef`):

| You write           | You get back  | Wrapping                                           |
| ------------------- | ------------- | -------------------------------------------------- |
| `posts`             | `Relation`    | `TableRef` for `public.posts`                      |
| `.innerJoin(users)` | `JoinBuilder` | `InnerJoin` around the `TableRef`, with `on: null` |
| `.where(...)`       | `Relation`    | `Where` around the `InnerJoin`                     |
| `.project(...)`     | `Relation`    | `Project` around the `Where`                       |

The AST node types are plain interfaces in `src/ast/relation.ts`, each
built by a small pure function (`where`, `project`, `innerJoin`, and so
on). A `Where`, for example, is just `{ kind: "Where", source, predicate }`.
The fluent layer imports these builders under `*Node` aliases (`where as
whereNode`) so the builder name doesn't clash with the operator method,
which is why the snippet above calls `whereNode`.

By the time the chain finishes, you're holding a `Relation` wrapping
this tree:

```
Project        items: users.email AS "email", posts.body AS "post"
└── Where      predicate: posts.body IS NOT NULL
    └── InnerJoin   on: null   (left side joins right; predicate deferred)
        ├── source: TableRef public.posts   (carries FK author_id -> users.id)
        └── right:  TableRef public.users
```

The last operator you called is the outermost node. The base table is
at the bottom. That ordering matters in a moment, when the serialiser
flattens the tree back into SQL clauses.

Two details worth noticing:

- **`innerJoin` returns a `JoinBuilder`, not a plain `Relation`.**
  `JoinBuilder` extends `Relation`, and its constructor builds the
  `InnerJoin` node with `on: null`. That makes the join runnable as-is:
  leave the `ON` off and tenon infers it later. Calling `.on(predicate)`
  instead returns a plain `Relation` whose `InnerJoin` carries your
  explicit predicate.
- **The right side of a join must be a table**, not another query.
  `innerJoin` checks that the right side's node is a `TableRef` and
  throws otherwise. Joining a sub-query isn't supported yet.

## Expressions are trees too

The predicate inside `.where(...)` is built the same way. `posts.body`
is a `Column`, and every comparator hangs off it (`eq`, `lt`, `in`,
`isNull`, and the rest). They live in `src/query/Column.ts` and produce
`Expression` values wrapping expression-level AST nodes from
`src/ast/expression.ts`.

`posts.body.isNotNull()` produces:

```
UnaryOp  operator: "IS NOT NULL"
└── ColumnRef  posts.body
```

That whole expression tree becomes the `predicate` field of the `Where`
node above.

One thing to note for later: a literal value in a comparison, like the
`5` in `users.id.eq(5)`, becomes a `Parameter` node that carries the
value. It does not get written into the predicate as text. This is how
tenon keeps values out of the SQL string (see
[parameters](#values-become-parameters) below).

## Nothing has touched the database yet

Everything so far is pure construction. Building the tree reads nothing
and writes nothing; it just allocates objects. The query doesn't run
until you hand the `Relation` to `db.run(...)`.

This is why a `Relation` is a value you can pass around, store, and
extend. "Take this query and filter it further" is just another
`.where(...)` wrapping another node.

## Serialising the tree to SQL

`db.run(relation)` calls `relationToSql(relation.node)` in
`src/sql/serialise.ts`. Serialisation is pure: a tree goes in, a SQL
string and a parameter array come out. It happens in two passes.

**First pass: walk the tree and collect clauses.** `collect` walks from
the outermost node down to the table, dropping each node's contribution
into a `CollectedClauses` record: the `Project` supplies the select
list, the `Where` adds a predicate, the `InnerJoin` adds a join, the
`TableRef` is the `FROM` table. The tree is nested in call order, but
SQL clauses have a fixed order, so this pass exists to regroup them.

**The join's `ON` is filled in here.** When `collect` hits the
`InnerJoin`, its `on` is `null`, so it calls `inferJoinPredicate`. That
function gathers the `TableRef`s on the left (`collectTableRefs`) and
looks for a single-column foreign key connecting either side to the
right table (`fkMatchesPointing`, in both directions). Our `posts`
table carries `author_id -> users.id`, so exactly one match is found,
and the predicate becomes `posts.author_id = users.id`. If zero foreign
keys matched, or more than one, or the two sides are the same physical
table, `inferJoinPredicate` throws. (The type system catches those same
cases earlier, at the `db.run` call; the runtime throw is the backstop.
See [the type system](types.md).)

**Second pass: emit the clauses in canonical SQL order.** `emitSelect`
writes the select list, then `FROM`, then joins, then `WHERE`, then
`ORDER BY` / `LIMIT` / `OFFSET`. Expressions are emitted recursively by
`emitExpression`. The select list drops the `AS` when an output name
already matches its column, which is why `users.email` emits bare but
`posts.body.as("post")` keeps its alias.

The result for our query:

```sql
SELECT "users"."email", "posts"."body" AS "post"
FROM "public"."posts"
INNER JOIN "public"."users" ON ("posts"."author_id" = "users"."id")
WHERE ("posts"."body" IS NOT NULL)
```

with an empty parameter array, because this query has no literal values.

### Values become parameters

Our example has no literals, so the parameter array is empty. When a
query does carry a value, the `Parameter` node holding it is emitted as
a `$1`, `$2`, ... placeholder, and the value is pushed onto the
parameter array in the same order. `emitExpression` assigns the numbers
left to right as it walks, so they always line up with the array. Values
reach Postgres as bound parameters, never as text spliced into the SQL,
so there's no SQL-injection surface.

## Executing

`Database.run` (in `src/executor/Database.ts`) is a thin wrapper over a
[`pg`](https://www.npmjs.com/package/pg) pool. It checks what kind of
statement it was given (`Insert`, `Update`, `Delete`, `SingleRow`, or a
plain `Relation`), serialises it with the matching function, and runs
the result:

```ts
const compiled = relationToSql(statement.node);
const result = await runner.query(compiled.text, [...compiled.params]);
return result.rows;
```

That's the whole runtime story. The rows come straight back from `pg`
as plain objects. Tenon doesn't reshape them; it trusts that the SQL it
emitted produces columns matching the row type it promised.

## Meanwhile, at the type level

Alongside the runtime tree, a second story plays out entirely in the
type system. It leaves no runtime trace, but it's why the query above
is known to return `Array<{ email: string; post: string | null }>`.

Each `Relation` carries a phantom `Columns` type describing its row
shape. `innerJoin` merges the two sides' column shapes; `project`
replaces them with just the projected columns, picking up the renamed
`post` from `.as("post")` and widening it to `string | null` because
`posts.body` is nullable. `db.run` reads that final shape to type its
result.

The same phantom types carry brands that make bad queries fail to
compile: an ambiguous or missing join, a self-join without an explicit
`ON`, a projection with duplicate column names. Each shows up as a type
error at the `db.run(...)` call, which is the runtime throw's
compile-time counterpart. The full mechanism is its own subject; see
[the type system](types.md).

## The whole pipeline at a glance

1. **Build.** Fluent operators (`src/query/`) wrap AST nodes
   (`src/ast/`) one layer at a time into an immutable tree. Pure, no
   I/O.
2. **Serialise.** `relationToSql` (`src/sql/serialise.ts`) walks the
   tree, infers any missing join predicates from foreign keys, and
   emits SQL plus a parameter array. Pure.
3. **Execute.** `Database.run` (`src/executor/`) hands the SQL and
   parameters to `pg` and returns the rows.
4. **Types**, in parallel the whole way, track the row shape and reject
   bad queries at the `db.run` call.

From here, [the AST](ast.md) details the node types, [the
serialiser](serialiser.md) goes deeper on emission and FK inference,
and [the type system](types.md) explains the phantom machinery.
