// Runtime tests for `Table.find` and SingleRow's SQL emission.
// Type-level coverage (find argument typing, find absence on
// composite-PK and no-PK tables) lives in find-types.test-d.ts.

import { describe, expect, it } from "vitest";

import {
  RowNotFoundError,
  SingleRow,
  SingleRowOrThrow,
} from "../../src/query/SingleRow.js";
import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";
import { relationToSql } from "../../src/sql/serialise.js";

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
  it("returns a SingleRow value", () => {
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

describe("SingleRow.orThrow", () => {
  it("returns a SingleRowOrThrow that wraps the same node", () => {
    const single = users.find(1);
    const throwing = single.orThrow();
    expect(throwing).toBeInstanceOf(SingleRowOrThrow);
    expect(throwing.node).toBe(single.node);
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
