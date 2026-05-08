// Serialiser tests for FK-inferred ON predicates. The serialiser
// fills in the join's ON clause from the FK metadata on TableRef
// when the AST node carries `on: null`. Build the AST directly so
// these tests don't depend on the fluent layer.

import { describe, expect, it } from "vitest";

import { innerJoin, tableRef } from "../../src/ast/relation.js";
import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";
import { relationToSql } from "../../src/sql/serialise.js";

const usersIdFkOnPosts = {
  name: "posts_author_id_fkey",
  columns: ["author_id"],
  referencedSchema: "public",
  referencedTable: "users",
  referencedColumns: ["id"],
} as const;

const postsIdFkOnComments = {
  name: "comments_post_id_fkey",
  columns: ["post_id"],
  referencedSchema: "public",
  referencedTable: "posts",
  referencedColumns: ["id"],
} as const;

const users = tableRef({ schema: "public", name: "users" });
const posts = tableRef({
  schema: "public",
  name: "posts",
  foreignKeys: [usersIdFkOnPosts],
});
const comments = tableRef({
  schema: "public",
  name: "comments",
  foreignKeys: [postsIdFkOnComments],
});

describe("serialiser FK-inferred ON predicate", () => {
  it("infers an ON predicate when source.foreignKeys references right", () => {
    const compiled = relationToSql(innerJoin(posts, users, null));
    expect(compiled.text).toBe(
      `SELECT * FROM "public"."posts" INNER JOIN "public"."users" ` +
        `ON ("posts"."author_id" = "users"."id")`,
    );
    expect(compiled.params).toEqual([]);
  });

  it("infers an ON predicate when right.foreignKeys references source", () => {
    const compiled = relationToSql(innerJoin(users, posts, null));
    expect(compiled.text).toBe(
      `SELECT * FROM "public"."users" INNER JOIN "public"."posts" ` +
        `ON ("posts"."author_id" = "users"."id")`,
    );
    expect(compiled.params).toEqual([]);
  });

  it("infers ON predicates across chained joins", () => {
    // comments → posts → users
    const node = innerJoin(innerJoin(comments, posts, null), users, null);
    const compiled = relationToSql(node);
    expect(compiled.text).toBe(
      `SELECT * FROM "public"."comments"` +
        ` INNER JOIN "public"."posts" ON ("comments"."post_id" = "posts"."id")` +
        ` INNER JOIN "public"."users" ON ("posts"."author_id" = "users"."id")`,
    );
  });

  it("respects table aliases in the inferred predicate", () => {
    const aliasedPosts = tableRef({
      schema: "public",
      name: "posts",
      alias: "p",
      foreignKeys: [usersIdFkOnPosts],
    });
    const aliasedUsers = tableRef({
      schema: "public",
      name: "users",
      alias: "u",
    });
    const compiled = relationToSql(innerJoin(aliasedPosts, aliasedUsers, null));
    expect(compiled.text).toBe(
      `SELECT * FROM "public"."posts" AS "p"` +
        ` INNER JOIN "public"."users" AS "u" ON ("p"."author_id" = "u"."id")`,
    );
  });

  it("throws when no FK connects the two sides", () => {
    const orphan = tableRef({ schema: "public", name: "orphans" });
    const stranger = tableRef({ schema: "public", name: "strangers" });
    expect(() => relationToSql(innerJoin(orphan, stranger, null))).toThrow(
      /no foreign key/i,
    );
  });

  it("throws when more than one FK connects the two sides", () => {
    const accountsCreatorFk = {
      name: "accounts_creator_id_fkey",
      columns: ["creator_id"],
      referencedSchema: "public",
      referencedTable: "users",
      referencedColumns: ["id"],
    } as const;
    const accountsOwnerFk = {
      name: "accounts_owner_id_fkey",
      columns: ["owner_id"],
      referencedSchema: "public",
      referencedTable: "users",
      referencedColumns: ["id"],
    } as const;
    const accounts = tableRef({
      schema: "public",
      name: "accounts",
      foreignKeys: [accountsCreatorFk, accountsOwnerFk],
    });
    expect(() => relationToSql(innerJoin(accounts, users, null))).toThrow(
      /ambiguous/i,
    );
  });

  it("ignores composite FKs even when the names match", () => {
    const compositeFk = {
      name: "events_user_fkey",
      columns: ["user_id", "tenant_id"],
      referencedSchema: "public",
      referencedTable: "users",
      referencedColumns: ["id", "tenant"],
    } as const;
    const events = tableRef({
      schema: "public",
      name: "events",
      foreignKeys: [compositeFk],
    });
    expect(() => relationToSql(innerJoin(events, users, null))).toThrow(
      /no foreign key/i,
    );
  });

  it("rejects inference when the right is the same physical table as a source", () => {
    const employees = tableRef({
      schema: "public",
      name: "employees",
      foreignKeys: [
        {
          name: "employees_manager_id_fkey",
          columns: ["manager_id"],
          referencedSchema: "public",
          referencedTable: "employees",
          referencedColumns: ["id"],
        },
      ],
    });
    const employeesAlias = tableRef({
      schema: "public",
      name: "employees",
      alias: "manager",
      foreignKeys: [
        {
          name: "employees_manager_id_fkey",
          columns: ["manager_id"],
          referencedSchema: "public",
          referencedTable: "employees",
          referencedColumns: ["id"],
        },
      ],
    });
    expect(() =>
      relationToSql(innerJoin(employees, employeesAlias, null)),
    ).toThrow(/self-join/i);
  });

  it("still uses an explicit ON predicate when one is supplied", () => {
    const explicitOn = {
      kind: "BinaryOp" as const,
      operator: "=" as const,
      left: { kind: "ColumnRef" as const, tableAlias: "posts", column: "id" },
      right: { kind: "ColumnRef" as const, tableAlias: "users", column: "id" },
    };
    const compiled = relationToSql(innerJoin(posts, users, explicitOn));
    expect(compiled.text).toBe(
      `SELECT * FROM "public"."posts" INNER JOIN "public"."users" ` +
        `ON ("posts"."id" = "users"."id")`,
    );
  });
});

describe("fluent layer with FK-inferred joins", () => {
  const usersTable = defineTable("public", "users", {
    id: columnType<number, "int4">({
      nullable: false,
      hasDefault: false,
      isGenerated: false,
    }),
  });
  const postsTable = defineTable(
    "public",
    "posts",
    {
      id: columnType<number, "int4">({
        nullable: false,
        hasDefault: false,
        isGenerated: false,
      }),
      author_id: columnType<number, "int4">({
        nullable: false,
        hasDefault: false,
        isGenerated: false,
      }),
    },
    [
      {
        name: "posts_author_id_fkey",
        columns: ["author_id"],
        referencedSchema: "public",
        referencedTable: "users",
        referencedColumns: ["id"],
      },
    ] as const,
  );

  it("Table.innerJoin(other) is runnable without .on() when an FK matches", () => {
    const compiled = relationToSql(postsTable.innerJoin(usersTable).node);
    expect(compiled.text).toBe(
      `SELECT * FROM "public"."posts" INNER JOIN "public"."users" ` +
        `ON ("posts"."author_id" = "users"."id")`,
    );
  });

  it("an explicit .on(...) call overrides the inferred predicate", () => {
    const overridden = postsTable
      .innerJoin(usersTable)
      .on(postsTable.id.eq(usersTable.id));
    const compiled = relationToSql(overridden.node);
    expect(compiled.text).toBe(
      `SELECT * FROM "public"."posts" INNER JOIN "public"."users" ` +
        `ON ("posts"."id" = "users"."id")`,
    );
  });

  it("post-join .where() still resolves the inferred ON predicate", () => {
    const filtered = postsTable
      .innerJoin(usersTable)
      .where(usersTable.id.eq(1));
    const compiled = relationToSql(filtered.node);
    expect(compiled.text).toBe(
      `SELECT * FROM "public"."posts" INNER JOIN "public"."users" ` +
        `ON ("posts"."author_id" = "users"."id") ` +
        `WHERE ("users"."id" = $1)`,
    );
    expect(compiled.params).toEqual([1]);
  });
});
