import { describe, expect, it } from "vitest";

import { emitSchemaFile } from "../../src/introspect/emit.js";
import type {
  CatalogColumn,
  CatalogForeignKey,
  CatalogPrimaryKey,
} from "../../src/introspect/readCatalog.js";

function column(
  schema: string,
  tableName: string,
  columnName: string,
  typname: string,
  nullable: boolean,
  hasDefault: boolean = false,
  isGenerated: boolean = false,
): CatalogColumn {
  return {
    schema,
    tableName,
    columnName,
    typname,
    nullable,
    hasDefault,
    isGenerated,
  };
}

describe("emitSchemaFile", () => {
  it("emits a header that imports defineTable and columnType", () => {
    const output = emitSchemaFile([
      column("public", "users", "id", "int4", false),
    ]);
    expect(output).toContain(
      `import { columnType, defineTable } from "@notahat/tenon/schema-runtime";`,
    );
  });

  it("emits one defineTable block per (schema, table) pair", () => {
    const output = emitSchemaFile([
      column("public", "users", "id", "int4", false),
      column("public", "users", "email", "text", false),
      column("public", "posts", "id", "int4", false),
    ]);
    expect(output).toContain(
      `export const users = defineTable("public", "users", {`,
    );
    expect(output).toContain(
      `export const posts = defineTable("public", "posts", {`,
    );
  });

  it("renders columns with their TS type, SQL tag, and per-column flags", () => {
    const output = emitSchemaFile([
      column("public", "users", "id", "int4", false),
      column("public", "users", "email", "text", true),
    ]);
    expect(output).toContain(
      `"id": columnType<number, "int4">({ nullable: false, hasDefault: false, isGenerated: false }),`,
    );
    expect(output).toContain(
      `"email": columnType<string, "text">({ nullable: true, hasDefault: false, isGenerated: false }),`,
    );
  });

  it("renders hasDefault and isGenerated when the catalog reports them", () => {
    const output = emitSchemaFile([
      column("public", "users", "id", "int4", false, true, false),
      column("public", "users", "full_name", "text", false, false, true),
    ]);
    expect(output).toContain(
      `"id": columnType<number, "int4">({ nullable: false, hasDefault: true, isGenerated: false }),`,
    );
    expect(output).toContain(
      `"full_name": columnType<string, "text">({ nullable: false, hasDefault: false, isGenerated: true }),`,
    );
  });

  it("annotates unknown types with a fallback comment", () => {
    const output = emitSchemaFile([
      column("public", "things", "tag", "citext", false),
    ]);
    expect(output).toContain(
      `// unknown Postgres type "citext"; falling back to string`,
    );
  });

  it("sanitises non-identifier table names for the export binding", () => {
    const output = emitSchemaFile([
      column("public", "weird-name", "id", "int4", false),
    ]);
    expect(output).toContain(
      `export const weird_name = defineTable("public", "weird-name", {`,
    );
  });

  it("escapes special characters in identifiers passed as string literals", () => {
    const output = emitSchemaFile([
      column("public", `weird"name`, "id", "int4", false),
    ]);
    expect(output).toContain(`defineTable("public", "weird\\"name"`);
  });

  it("omits the foreignKeys argument when no FKs are supplied", () => {
    const output = emitSchemaFile(
      [column("public", "users", "id", "int4", false)],
      [],
    );
    expect(output).not.toContain("], [");
    expect(output).toMatch(/defineTable\("public", "users", \{[\s\S]*?\}\);/);
  });

  it("renders a fourth-argument FK array for single-column FKs", () => {
    const fk: CatalogForeignKey = {
      name: "posts_author_id_fkey",
      schema: "public",
      tableName: "posts",
      columns: ["author_id"],
      referencedSchema: "public",
      referencedTable: "users",
      referencedColumns: ["id"],
    };
    const output = emitSchemaFile(
      [
        column("public", "posts", "id", "int4", false),
        column("public", "posts", "author_id", "int4", false),
      ],
      [fk],
    );
    expect(output).toContain(`}, [
  {
    name: "posts_author_id_fkey",
    columns: ["author_id"],
    referencedSchema: "public",
    referencedTable: "users",
    referencedColumns: ["id"],
  },
]);`);
  });

  it("attaches FKs to the correct table when several tables are emitted", () => {
    const usersToOrgs: CatalogForeignKey = {
      name: "users_org_id_fkey",
      schema: "public",
      tableName: "users",
      columns: ["org_id"],
      referencedSchema: "public",
      referencedTable: "organizations",
      referencedColumns: ["id"],
    };
    const output = emitSchemaFile(
      [
        column("public", "users", "id", "int4", false),
        column("public", "users", "org_id", "int4", false),
        column("public", "organizations", "id", "int4", false),
      ],
      [usersToOrgs],
    );
    const usersBlock = output.slice(
      output.indexOf("export const users"),
      output.indexOf("export const organizations"),
    );
    const orgsBlock = output.slice(
      output.indexOf("export const organizations"),
    );
    expect(usersBlock).toContain(`name: "users_org_id_fkey"`);
    expect(orgsBlock).not.toContain(`users_org_id_fkey`);
  });

  it("renders a fifth-argument primary key when supplied", () => {
    const pk: CatalogPrimaryKey = {
      schema: "public",
      tableName: "users",
      columns: ["id"],
    };
    const output = emitSchemaFile(
      [column("public", "users", "id", "int4", false)],
      [],
      [pk],
    );
    expect(output).toContain(`}, [], { columns: ["id"] });`);
  });

  it("renders both FKs and a primary key together", () => {
    const fk: CatalogForeignKey = {
      name: "posts_author_id_fkey",
      schema: "public",
      tableName: "posts",
      columns: ["author_id"],
      referencedSchema: "public",
      referencedTable: "users",
      referencedColumns: ["id"],
    };
    const pk: CatalogPrimaryKey = {
      schema: "public",
      tableName: "posts",
      columns: ["id"],
    };
    const output = emitSchemaFile(
      [
        column("public", "posts", "id", "int4", false),
        column("public", "posts", "author_id", "int4", false),
      ],
      [fk],
      [pk],
    );
    expect(output).toContain(`], { columns: ["id"] });`);
  });

  it("emits composite primary keys faithfully", () => {
    const pk: CatalogPrimaryKey = {
      schema: "public",
      tableName: "tenant_users",
      columns: ["tenant_id", "user_id"],
    };
    const output = emitSchemaFile(
      [
        column("public", "tenant_users", "tenant_id", "int4", false),
        column("public", "tenant_users", "user_id", "int4", false),
      ],
      [],
      [pk],
    );
    expect(output).toContain(`{ columns: ["tenant_id", "user_id"] }`);
  });

  it("omits the primary key argument entirely when none is supplied", () => {
    const output = emitSchemaFile(
      [column("public", "users", "id", "int4", false)],
      [],
      [],
    );
    expect(output).not.toContain("columns:");
  });

  it("attaches primary keys to the correct table when several are emitted", () => {
    const usersPk: CatalogPrimaryKey = {
      schema: "public",
      tableName: "users",
      columns: ["id"],
    };
    const output = emitSchemaFile(
      [
        column("public", "users", "id", "int4", false),
        column("public", "events", "id", "int4", false),
      ],
      [],
      [usersPk],
    );
    const usersBlock = output.slice(
      output.indexOf("export const users"),
      output.indexOf("export const events"),
    );
    const eventsBlock = output.slice(output.indexOf("export const events"));
    expect(usersBlock).toContain(`{ columns: ["id"] }`);
    expect(eventsBlock).not.toContain(`columns:`);
  });

  it("drops composite FKs and leaves a comment above the table", () => {
    const compositeFk: CatalogForeignKey = {
      name: "order_lines_orders_fkey",
      schema: "public",
      tableName: "order_lines",
      columns: ["tenant_id", "order_id"],
      referencedSchema: "public",
      referencedTable: "orders",
      referencedColumns: ["tenant", "id"],
    };
    const output = emitSchemaFile(
      [
        column("public", "order_lines", "tenant_id", "int4", false),
        column("public", "order_lines", "order_id", "int4", false),
      ],
      [compositeFk],
    );
    expect(output).toContain(
      `// Skipped composite foreign key "order_lines_orders_fkey"`,
    );
    expect(output).toContain(
      `// composite FKs are not yet surfaced in tenon's type-level inference.`,
    );
    expect(output).not.toContain(`name: "order_lines_orders_fkey"`);
  });
});
