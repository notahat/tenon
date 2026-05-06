import { describe, expect, it } from "vitest";

import { emitSchemaFile } from "../../src/introspect/emit.js";
import type { CatalogColumn } from "../../src/introspect/readCatalog.js";

function column(
  schema: string,
  tableName: string,
  columnName: string,
  typname: string,
  nullable: boolean,
  ordinalPosition: number,
): CatalogColumn {
  return { schema, tableName, columnName, typname, nullable, ordinalPosition };
}

describe("emitSchemaFile", () => {
  it("emits a header that imports defineTable and columnType", () => {
    const output = emitSchemaFile([
      column("public", "users", "id", "int4", false, 1),
    ]);
    expect(output).toContain(
      `import { columnType, defineTable } from "@notahat/tenon/schema-runtime";`,
    );
  });

  it("emits one defineTable block per (schema, table) pair", () => {
    const output = emitSchemaFile([
      column("public", "users", "id", "int4", false, 1),
      column("public", "users", "email", "text", false, 2),
      column("public", "posts", "id", "int4", false, 1),
    ]);
    expect(output).toContain(
      `export const users = defineTable("public", "users", {`,
    );
    expect(output).toContain(
      `export const posts = defineTable("public", "posts", {`,
    );
  });

  it("renders columns with their TS type, SQL tag, and nullability", () => {
    const output = emitSchemaFile([
      column("public", "users", "id", "int4", false, 1),
      column("public", "users", "email", "text", true, 2),
    ]);
    expect(output).toContain(
      `"id": columnType<number, "int4">({ nullable: false }),`,
    );
    expect(output).toContain(
      `"email": columnType<string, "text">({ nullable: true }),`,
    );
  });

  it("annotates unknown types with a fallback comment", () => {
    const output = emitSchemaFile([
      column("public", "things", "tag", "citext", false, 1),
    ]);
    expect(output).toContain(
      `// unknown Postgres type "citext"; falling back to string`,
    );
  });

  it("sanitises non-identifier table names for the export binding", () => {
    const output = emitSchemaFile([
      column("public", "weird-name", "id", "int4", false, 1),
    ]);
    expect(output).toContain(
      `export const weird_name = defineTable("public", "weird-name", {`,
    );
  });

  it("escapes special characters in identifiers passed as string literals", () => {
    const output = emitSchemaFile([
      column("public", `weird"name`, "id", "int4", false, 1),
    ]);
    expect(output).toContain(`defineTable("public", "weird\\"name"`);
  });
});
