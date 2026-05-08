// Runtime tests for `Table.find` and SingleRow's SQL emission.
// Type-level coverage (find argument typing, find absence on
// composite-PK and no-PK tables) lives in find-types.test-d.ts.

import { describe, expect, it } from "vitest";

import { Delete } from "../../src/query/Delete.js";
import {
  WritableSingleRow,
  RowNotFoundError,
  SingleRow,
} from "../../src/query/SingleRow.js";
import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";
import { deleteToSql, relationToSql } from "../../src/sql/serialise.js";

const users = defineTable(
  "public",
  "users",
  {
    id: columnType<number, "int4">({
      nullable: false,
      hasDefault: true,
      isGenerated: false,
    }),
    email: columnType<string, "text">({
      nullable: false,
      hasDefault: false,
      isGenerated: false,
    }),
  },
  [],
  { columns: ["id"] },
);

describe("Table.find", () => {
  it("returns a WritableSingleRow value", () => {
    expect(users.find(1)).toBeInstanceOf(WritableSingleRow);
  });

  it("is also a SingleRow (WritableSingleRow extends SingleRow)", () => {
    expect(users.find(1)).toBeInstanceOf(SingleRow);
  });

  it("emits a primary-key WHERE plus LIMIT 1", () => {
    const compiled = relationToSql(users.find(42).node);
    expect(compiled.text).toBe(
      `SELECT * FROM "public"."users" WHERE ("users"."id" = $1) LIMIT 1`,
    );
    expect(compiled.params).toEqual([42]);
  });

  it("preserves the table alias when called on an aliased table", () => {
    const compiled = relationToSql(users.as("u").find(7).node);
    expect(compiled.text).toBe(
      `SELECT * FROM "public"."users" AS "u" WHERE ("u"."id" = $1) LIMIT 1`,
    );
    expect(compiled.params).toEqual([7]);
  });
});

describe("WritableSingleRow.delete", () => {
  it("returns a Delete instance", () => {
    expect(users.find(1).delete()).toBeInstanceOf(Delete);
  });

  it("emits DELETE FROM ... WHERE pk = ? without LIMIT", () => {
    const compiled = deleteToSql(users.find(42).delete().node);
    expect(compiled.text).toBe(
      `DELETE FROM "public"."users" WHERE ("users"."id" = $1)`,
    );
    expect(compiled.params).toEqual([42]);
  });

  it("preserves the table alias when called on an aliased table", () => {
    const compiled = deleteToSql(users.as("u").find(7).delete().node);
    expect(compiled.text).toBe(
      `DELETE FROM "public"."users" AS "u" WHERE ("u"."id" = $1)`,
    );
    expect(compiled.params).toEqual([7]);
  });

  it("supports chaining .returning(...) for RETURNING clauses", () => {
    const compiled = deleteToSql(
      users.find(1).delete().returning(users.email).node,
    );
    expect(compiled.text).toBe(
      `DELETE FROM "public"."users" WHERE ("users"."id" = $1) ` +
        `RETURNING "users"."email"`,
    );
    expect(compiled.params).toEqual([1]);
  });
});

describe("RowNotFoundError", () => {
  it("is an Error with a recognisable name", () => {
    const error = new RowNotFoundError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("RowNotFoundError");
  });
});

describe("Table.find absence", () => {
  it("is not present on tables without a primary key", () => {
    const events = defineTable("public", "events", {
      id: columnType<number, "int4">({
        nullable: false,
        hasDefault: true,
        isGenerated: false,
      }),
    });
    expect((events as { find?: unknown }).find).toBeUndefined();
  });

  it("is not present on tables with a composite primary key", () => {
    const tenantUsers = defineTable(
      "public",
      "tenant_users",
      {
        tenant_id: columnType<number, "int4">({
          nullable: false,
          hasDefault: false,
          isGenerated: false,
        }),
        user_id: columnType<number, "int4">({
          nullable: false,
          hasDefault: false,
          isGenerated: false,
        }),
      },
      [],
      { columns: ["tenant_id", "user_id"] },
    );
    expect((tenantUsers as { find?: unknown }).find).toBeUndefined();
  });
});
