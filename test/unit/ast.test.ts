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
    });
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
