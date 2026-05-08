import { describe, expect, it } from "vitest";

import { tableRef } from "../../src/ast/relation.js";

describe("tableRef factory", () => {
  it("builds a TableRef node with the given schema and name", () => {
    const node = tableRef({ schema: "public", name: "users" });

    expect(node).toEqual({
      kind: "TableRef",
      schema: "public",
      name: "users",
      alias: null,
      foreignKeys: [],
    });
  });

  it("captures the foreign-key list when supplied", () => {
    const fk = {
      name: "posts_author_id_fkey",
      columns: ["author_id"],
      referencedSchema: "public",
      referencedTable: "users",
      referencedColumns: ["id"],
    };
    const node = tableRef({
      schema: "public",
      name: "posts",
      foreignKeys: [fk],
    });
    expect(node.foreignKeys).toEqual([fk]);
  });

  it("captures an explicit alias when provided", () => {
    const node = tableRef({ schema: "public", name: "users", alias: "u" });

    expect(node.alias).toBe("u");
  });

  it("returns a fresh object on each call (no shared mutable state)", () => {
    const a = tableRef({ schema: "public", name: "users" });
    const b = tableRef({ schema: "public", name: "users" });

    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
