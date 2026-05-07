import { describe, expect, it } from "vitest";

import { columnRef, parameter } from "../../src/ast/expression.js";
import { insertColumnValue, insertNode } from "../../src/ast/insert.js";
import { projectionItem, tableRef } from "../../src/ast/relation.js";
import { insertToSql } from "../../src/sql/serialise.js";

describe("insertToSql", () => {
  it("emits INSERT INTO ... (cols) VALUES (params) with parameters in source order", () => {
    const compiled = insertToSql(
      insertNode({
        target: tableRef({ schema: "public", name: "users" }),
        columnValues: [
          insertColumnValue("name", parameter("Pete")),
          insertColumnValue("age", parameter(42)),
        ],
      }),
    );

    expect(compiled).toEqual({
      text: `INSERT INTO "public"."users" ("name", "age") VALUES ($1, $2)`,
      params: ["Pete", 42],
    });
  });

  it("quotes schema, table, and column identifiers", () => {
    const compiled = insertToSql(
      insertNode({
        target: tableRef({ schema: "App", name: `weird"name` }),
        columnValues: [insertColumnValue(`odd"col`, parameter(1))],
      }),
    );

    expect(compiled.text).toBe(
      `INSERT INTO "App"."weird""name" ("odd""col") VALUES ($1)`,
    );
  });

  it("ignores any alias on the target TableRef (INSERT INTO does not need one)", () => {
    const compiled = insertToSql(
      insertNode({
        target: tableRef({ schema: "public", name: "users", alias: "u" }),
        columnValues: [insertColumnValue("name", parameter("Pete"))],
      }),
    );

    expect(compiled.text).toBe(
      `INSERT INTO "public"."users" ("name") VALUES ($1)`,
    );
  });

  it("emits DEFAULT VALUES when the column-values list is empty", () => {
    const compiled = insertToSql(
      insertNode({
        target: tableRef({ schema: "public", name: "users" }),
        columnValues: [],
      }),
    );

    expect(compiled).toEqual({
      text: `INSERT INTO "public"."users" DEFAULT VALUES`,
      params: [],
    });
  });

  it("appends RETURNING with bare columns when they keep their name", () => {
    const compiled = insertToSql(
      insertNode({
        target: tableRef({ schema: "public", name: "users" }),
        columnValues: [insertColumnValue("name", parameter("Pete"))],
        returning: [
          projectionItem(
            columnRef({ tableAlias: "users", column: "id" }),
            "id",
          ),
          projectionItem(
            columnRef({ tableAlias: "users", column: "name" }),
            "name",
          ),
        ],
      }),
    );

    expect(compiled.text).toBe(
      `INSERT INTO "public"."users" ("name") VALUES ($1) RETURNING "users"."id", "users"."name"`,
    );
    expect(compiled.params).toEqual(["Pete"]);
  });

  it("emits AS when a returning item is renamed", () => {
    const compiled = insertToSql(
      insertNode({
        target: tableRef({ schema: "public", name: "users" }),
        columnValues: [insertColumnValue("name", parameter("Pete"))],
        returning: [
          projectionItem(
            columnRef({ tableAlias: "users", column: "id" }),
            "userId",
          ),
        ],
      }),
    );

    expect(compiled.text).toBe(
      `INSERT INTO "public"."users" ("name") VALUES ($1) RETURNING "users"."id" AS "userId"`,
    );
  });

  it("supports DEFAULT VALUES + RETURNING together", () => {
    const compiled = insertToSql(
      insertNode({
        target: tableRef({ schema: "public", name: "users" }),
        columnValues: [],
        returning: [
          projectionItem(
            columnRef({ tableAlias: "users", column: "id" }),
            "id",
          ),
        ],
      }),
    );

    expect(compiled.text).toBe(
      `INSERT INTO "public"."users" DEFAULT VALUES RETURNING "users"."id"`,
    );
  });
});
