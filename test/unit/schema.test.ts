import { describe, expect, it } from "vitest";

import { columnType } from "../../src/schema-runtime/columnType.js";
import { defineTable } from "../../src/schema-runtime/defineTable.js";
import { Column } from "../../src/query/Column.js";

describe("columnType", () => {
  it("captures nullability at runtime and via the type parameter", () => {
    const nonNullable = columnType<number, "int4">({
      nullable: false,
      hasDefault: false,
      isGenerated: false,
    });
    const nullable = columnType<number, "int4">({
      nullable: true,
      hasDefault: false,
      isGenerated: false,
    });

    expect(nonNullable.nullable).toBe(false);
    expect(nullable.nullable).toBe(true);
  });

  it("captures hasDefault and isGenerated flags at runtime", () => {
    const serialPk = columnType<number, "int4">({
      nullable: false,
      hasDefault: true,
      isGenerated: false,
    });
    const computed = columnType<string, "text">({
      nullable: false,
      hasDefault: false,
      isGenerated: true,
    });

    expect(serialPk.hasDefault).toBe(true);
    expect(serialPk.isGenerated).toBe(false);
    expect(computed.hasDefault).toBe(false);
    expect(computed.isGenerated).toBe(true);
  });
});

describe("defineTable", () => {
  it("returns an object exposing each declared column as a Column", () => {
    const users = defineTable("public", "users", {
      id: columnType<number, "int4">({
        nullable: false,
        hasDefault: false,
        isGenerated: false,
      }),
      email: columnType<string, "text">({
        nullable: false,
        hasDefault: false,
        isGenerated: false,
      }),
    });

    expect(users.id).toBeInstanceOf(Column);
    expect(users.email).toBeInstanceOf(Column);
  });

  it("uses the table name as the default alias", () => {
    const users = defineTable("public", "users", {
      id: columnType<number, "int4">({
        nullable: false,
        hasDefault: false,
        isGenerated: false,
      }),
    });

    expect(users.id.node).toEqual({
      kind: "ColumnRef",
      tableAlias: "users",
      column: "id",
    });
  });

  it("defaults the foreign-key list to empty when none are supplied", () => {
    const users = defineTable("public", "users", {
      id: columnType<number, "int4">({
        nullable: false,
        hasDefault: false,
        isGenerated: false,
      }),
    });

    expect(users._foreignKeys).toEqual([]);
  });

  it("stores the supplied foreign-key list verbatim", () => {
    const posts = defineTable(
      "public",
      "posts",
      {
        id: columnType<number, "int4">({
          nullable: false,
          hasDefault: true,
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
      ],
    );

    expect(posts._foreignKeys).toEqual([
      {
        name: "posts_author_id_fkey",
        columns: ["author_id"],
        referencedSchema: "public",
        referencedTable: "users",
        referencedColumns: ["id"],
      },
    ]);
  });

  it("preserves foreign keys when a table is aliased", () => {
    const posts = defineTable(
      "public",
      "posts",
      {
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
      ],
    );

    const aliased = posts.as("p");
    expect(aliased._foreignKeys).toEqual([
      {
        name: "posts_author_id_fkey",
        columns: ["author_id"],
        referencedSchema: "public",
        referencedTable: "users",
        referencedColumns: ["id"],
      },
    ]);
  });
});
