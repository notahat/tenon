import { describe, expect, it } from "vitest";

import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";
import { Column } from "../../src/query/Column.js";

describe("columnType", () => {
  it("captures nullability at runtime and via the type parameter", () => {
    const nonNullable = columnType<number, "int4">({ nullable: false });
    const nullable = columnType<number, "int4">({ nullable: true });

    expect(nonNullable.nullable).toBe(false);
    expect(nullable.nullable).toBe(true);
  });
});

describe("defineTable", () => {
  it("returns an object exposing each declared column as a Column", () => {
    const users = defineTable("public", "users", {
      id: columnType<number, "int4">({ nullable: false }),
      email: columnType<string, "text">({ nullable: false }),
    });

    expect(users.id).toBeInstanceOf(Column);
    expect(users.email).toBeInstanceOf(Column);
  });

  it("uses the table name as the default alias", () => {
    const users = defineTable("public", "users", {
      id: columnType<number, "int4">({ nullable: false }),
    });

    expect(users.id.node).toEqual({
      kind: "ColumnRef",
      tableAlias: "users",
      column: "id",
    });
  });
});
