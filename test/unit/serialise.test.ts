import { describe, expect, it } from "vitest";

import { tableRef } from "../../src/ast/relation.js";
import { relationToSql } from "../../src/sql/serialise.js";

describe("relationToSql for TableRef", () => {
  it("emits SELECT * FROM with schema-qualified, quoted identifiers", () => {
    const compiled = relationToSql(
      tableRef({ schema: "public", name: "users" }),
    );

    expect(compiled).toEqual({
      text: `SELECT * FROM "public"."users"`,
      params: [],
    });
  });

  it("preserves mixed-case schema and table names", () => {
    const compiled = relationToSql(
      tableRef({ schema: "App", name: "UserAccounts" }),
    );

    expect(compiled.text).toBe(`SELECT * FROM "App"."UserAccounts"`);
  });

  it("escapes embedded double quotes in identifiers", () => {
    const compiled = relationToSql(
      tableRef({ schema: "public", name: `weird"name` }),
    );

    expect(compiled.text).toBe(`SELECT * FROM "public"."weird""name"`);
  });

  it("emits an AS clause when an alias differs from the table name", () => {
    const compiled = relationToSql(
      tableRef({ schema: "public", name: "users", alias: "u" }),
    );

    expect(compiled.text).toBe(`SELECT * FROM "public"."users" AS "u"`);
  });

  it("omits the AS clause when no alias is set", () => {
    const compiled = relationToSql(
      tableRef({ schema: "public", name: "users" }),
    );

    expect(compiled.text).not.toContain(" AS ");
  });

  it("returns an empty params array (TableRef has no parameters)", () => {
    const compiled = relationToSql(
      tableRef({ schema: "public", name: "users" }),
    );

    expect(compiled.params).toEqual([]);
  });
});
