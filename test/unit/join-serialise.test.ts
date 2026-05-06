import { describe, expect, it } from "vitest";

import { binaryOp, columnRef, parameter } from "../../src/ast/expression.js";
import {
  innerJoin,
  order,
  orderTerm,
  project,
  projectionItem,
  tableRef,
  where,
} from "../../src/ast/relation.js";
import { relationToSql } from "../../src/sql/serialise.js";

const users = tableRef({ schema: "public", name: "users" });
const posts = tableRef({ schema: "public", name: "posts" });
const usersAuthors = tableRef({ schema: "public", name: "authors" });

const usersIdEqPostsAuthorId = binaryOp(
  "=",
  columnRef({ tableAlias: "users", column: "id" }),
  columnRef({ tableAlias: "posts", column: "author_id" }),
);

const postsAuthorIdEqAuthorsId = binaryOp(
  "=",
  columnRef({ tableAlias: "posts", column: "author_id" }),
  columnRef({ tableAlias: "authors", column: "id" }),
);

describe("relationToSql for InnerJoin", () => {
  it("emits a single INNER JOIN ... ON between FROM and the rest", () => {
    const compiled = relationToSql(
      innerJoin(users, posts, usersIdEqPostsAuthorId),
    );

    expect(compiled.text).toBe(
      `SELECT * FROM "public"."users" INNER JOIN "public"."posts" ON ("users"."id" = "posts"."author_id")`,
    );
    expect(compiled.params).toEqual([]);
  });

  it("emits stacked INNER JOINs in source-tree order (left-deep)", () => {
    const node = innerJoin(
      innerJoin(users, posts, usersIdEqPostsAuthorId),
      usersAuthors,
      postsAuthorIdEqAuthorsId,
    );

    const compiled = relationToSql(node);

    expect(compiled.text).toBe(
      `SELECT * FROM "public"."users"` +
        ` INNER JOIN "public"."posts" ON ("users"."id" = "posts"."author_id")` +
        ` INNER JOIN "public"."authors" ON ("posts"."author_id" = "authors"."id")`,
    );
  });

  it("emits FROM, JOIN, WHERE, ORDER BY, projection in canonical order", () => {
    const joined = innerJoin(users, posts, usersIdEqPostsAuthorId);
    const filtered = where(
      joined,
      binaryOp(
        "=",
        columnRef({ tableAlias: "posts", column: "published" }),
        parameter(true),
      ),
    );
    const ordered = order(filtered, [
      orderTerm(columnRef({ tableAlias: "users", column: "id" }), "asc"),
    ]);
    const projected = project(ordered, [
      projectionItem(
        columnRef({ tableAlias: "users", column: "email" }),
        "email",
      ),
      projectionItem(
        columnRef({ tableAlias: "posts", column: "body" }),
        "post",
      ),
    ]);

    const compiled = relationToSql(projected);

    expect(compiled.text).toBe(
      `SELECT "users"."email", "posts"."body" AS "post"` +
        ` FROM "public"."users"` +
        ` INNER JOIN "public"."posts" ON ("users"."id" = "posts"."author_id")` +
        ` WHERE ("posts"."published" = $1)` +
        ` ORDER BY "users"."id" ASC`,
    );
    expect(compiled.params).toEqual([true]);
  });

  it("numbers parameters left-to-right across ON predicates and a trailing WHERE", () => {
    const onWithParam = binaryOp(
      "AND",
      usersIdEqPostsAuthorId,
      binaryOp(
        "=",
        columnRef({ tableAlias: "posts", column: "kind" }),
        parameter("article"),
      ),
    );
    const joined = innerJoin(users, posts, onWithParam);
    const filtered = where(
      joined,
      binaryOp(
        ">",
        columnRef({ tableAlias: "users", column: "id" }),
        parameter(10),
      ),
    );

    const compiled = relationToSql(filtered);

    expect(compiled.text).toBe(
      `SELECT * FROM "public"."users"` +
        ` INNER JOIN "public"."posts" ON` +
        ` (("users"."id" = "posts"."author_id") AND ("posts"."kind" = $1))` +
        ` WHERE ("users"."id" > $2)`,
    );
    expect(compiled.params).toEqual(["article", 10]);
  });

  it("quotes identifiers on the joined-in table", () => {
    const weird = tableRef({ schema: "public", name: `weird"name` });
    const onPredicate = binaryOp(
      "=",
      columnRef({ tableAlias: "users", column: "id" }),
      columnRef({ tableAlias: `weird"name`, column: "user_id" }),
    );

    const compiled = relationToSql(innerJoin(users, weird, onPredicate));

    expect(compiled.text).toBe(
      `SELECT * FROM "public"."users"` +
        ` INNER JOIN "public"."weird""name" ON` +
        ` ("users"."id" = "weird""name"."user_id")`,
    );
  });

  it("renders an aliased joined table with AS when the alias differs from the name", () => {
    const aliased = tableRef({
      schema: "public",
      name: "users",
      alias: "u2",
    });
    const onPredicate = binaryOp(
      "=",
      columnRef({ tableAlias: "users", column: "id" }),
      columnRef({ tableAlias: "u2", column: "manager_id" }),
    );

    const compiled = relationToSql(innerJoin(users, aliased, onPredicate));

    expect(compiled.text).toBe(
      `SELECT * FROM "public"."users"` +
        ` INNER JOIN "public"."users" AS "u2" ON` +
        ` ("users"."id" = "u2"."manager_id")`,
    );
  });
});
