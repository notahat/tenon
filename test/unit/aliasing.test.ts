import { describe, expect, it } from "vitest";

import { Relation } from "../../src/query/Relation.js";
import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";
import { relationToSql } from "../../src/sql/serialise.js";

const users = defineTable("public", "users", {
  id: columnType<number, "int4">({
    nullable: false,
    hasDefault: false,
    isGenerated: false,
  }),
  manager_id: columnType<number, "int4">({
    nullable: true,
    hasDefault: false,
    isGenerated: false,
  }),
  email: columnType<string, "text">({
    nullable: false,
    hasDefault: false,
    isGenerated: false,
  }),
});

describe("Table.as(alias)", () => {
  it("returns a Relation that exposes column accessors", () => {
    const aliased = users.as("u");
    expect(aliased).toBeInstanceOf(Relation);
    expect(aliased.id).toBeDefined();
    expect(aliased.email).toBeDefined();
    expect(aliased.manager_id).toBeDefined();
  });

  it("stamps the alias on the TableRef and on each column accessor", () => {
    const aliased = users.as("u");
    expect(aliased.node).toEqual({
      kind: "TableRef",
      schema: "public",
      name: "users",
      alias: "u",
    });
    expect(aliased.id.tableAlias).toBe("u");
    expect(aliased.id.node).toEqual({
      kind: "ColumnRef",
      tableAlias: "u",
      column: "id",
    });
  });

  it("preserves _schema and updates _tableName to the alias", () => {
    const aliased = users.as("u");
    expect(aliased._schema).toBe("public");
    expect(aliased._tableName).toBe("u");
  });

  it("does not mutate the original table", () => {
    const aliased = users.as("u");
    expect(users._tableName).toBe("users");
    expect(users.id.tableAlias).toBe("users");
    expect(aliased).not.toBe(users);
  });

  it("supports re-aliasing via a second .as call", () => {
    const reAliased = users.as("u").as("v");
    expect(reAliased._tableName).toBe("v");
    expect(reAliased.id.tableAlias).toBe("v");
    expect(reAliased.node).toEqual({
      kind: "TableRef",
      schema: "public",
      name: "users",
      alias: "v",
    });
  });

  it("emits FROM ... AS <alias> in serialised SQL", () => {
    const compiled = relationToSql(users.as("u").node);
    expect(compiled.text).toBe(`SELECT * FROM "public"."users" AS "u"`);
    expect(compiled.params).toEqual([]);
  });

  it("supports a self-join: users INNER JOIN users AS manager", () => {
    const manager = users.as("manager");
    const joined = users
      .innerJoin(manager)
      .on(users.manager_id.eq(manager.id))
      .project(users.email, manager.email.as("manager_email"));

    const compiled = relationToSql(joined.node);

    expect(compiled.text).toBe(
      `SELECT "users"."email", "manager"."email" AS "manager_email"` +
        ` FROM "public"."users"` +
        ` INNER JOIN "public"."users" AS "manager"` +
        ` ON ("users"."manager_id" = "manager"."id")`,
    );
    expect(compiled.params).toEqual([]);
  });
});
