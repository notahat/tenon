// Drives the introspection generator against a real Postgres: create
// a couple of tables in a fresh schema, run generateSchema, and
// assert the emitted file content matches what the schema declares.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { generateSchema } from "../../src/introspect/generate.js";
import { readCatalog } from "../../src/introspect/readCatalog.js";
import { sharedPool, withTestSchema } from "./setup.js";

const DATABASE_URL = process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) {
  throw new Error("DATABASE_URL must be set for integration tests.");
}

afterAll(async () => {
  await sharedPool.end();
});

describe("generateSchema", () => {
  it("emits defineTable blocks for every table in the requested schema", async () => {
    await withTestSchema("tenon_introspect", async (schema) => {
      const client = await sharedPool.connect();
      try {
        await client.query(
          `CREATE TABLE "${schema}"."users" (
             id integer NOT NULL,
             email text NOT NULL,
             age integer,
             created_at timestamptz NOT NULL
           )`,
        );
        await client.query(
          `CREATE TABLE "${schema}"."posts" (
             id integer NOT NULL,
             author_id integer NOT NULL,
             body text
           )`,
        );
      } finally {
        client.release();
      }

      const tempDir = await mkdtemp(join(tmpdir(), "tenon-test-"));
      const outputPath = join(tempDir, "schema.ts");
      try {
        await generateSchema({
          databaseUrl: DATABASE_URL,
          schemas: [schema],
          outputPath,
        });
        const file = await readFile(outputPath, "utf8");

        expect(file).toContain(
          `import {\n  columnType,\n  defineSchema,\n  defineTable,\n} from "@notahat/tenon/schema-runtime";`,
        );
        expect(file).toContain(`export const schema = defineSchema({`);
        expect(file).toContain(`users: defineTable("${schema}", "users", {`);
        expect(file).toContain(
          `"id": columnType<number, "int4">({ nullable: false, hasDefault: false, isGenerated: false }),`,
        );
        expect(file).toContain(
          `"email": columnType<string, "text">({ nullable: false, hasDefault: false, isGenerated: false }),`,
        );
        expect(file).toContain(
          `"age": columnType<number, "int4">({ nullable: true, hasDefault: false, isGenerated: false }),`,
        );
        expect(file).toContain(
          `"created_at": columnType<Date, "timestamptz">({ nullable: false, hasDefault: false, isGenerated: false }),`,
        );
        expect(file).toContain(`posts: defineTable("${schema}", "posts", {`);
        expect(file).toContain(
          `"author_id": columnType<number, "int4">({ nullable: false, hasDefault: false, isGenerated: false }),`,
        );
        // Tables come back from pg_catalog in alphabetical order
        // within a schema, so the destructure is `posts, users`.
        expect(file).toContain(`export const { posts, users } = schema;`);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  it("ignores foreign keys when none are declared", async () => {
    await withTestSchema("tenon_introspect_no_fk", async (schema) => {
      const client = await sharedPool.connect();
      try {
        await client.query(
          `CREATE TABLE "${schema}"."solo" (id integer NOT NULL)`,
        );
        const catalog = await readCatalog(client, [schema]);
        expect(catalog.foreignKeys).toEqual([]);
      } finally {
        client.release();
      }
    });
  });

  it("reads single-column foreign keys from pg_constraint", async () => {
    await withTestSchema("tenon_introspect_fk", async (schema) => {
      const client = await sharedPool.connect();
      try {
        await client.query(
          `CREATE TABLE "${schema}"."users" (id integer PRIMARY KEY)`,
        );
        await client.query(
          `CREATE TABLE "${schema}"."posts" (
             id integer PRIMARY KEY,
             author_id integer NOT NULL REFERENCES "${schema}"."users"(id)
           )`,
        );
        const catalog = await readCatalog(client, [schema]);
        expect(catalog.foreignKeys).toEqual([
          {
            name: "posts_author_id_fkey",
            schema,
            tableName: "posts",
            columns: ["author_id"],
            referencedSchema: schema,
            referencedTable: "users",
            referencedColumns: ["id"],
          },
        ]);
      } finally {
        client.release();
      }
    });
  });

  it("reads composite foreign keys preserving column order", async () => {
    await withTestSchema("tenon_introspect_fk_composite", async (schema) => {
      const client = await sharedPool.connect();
      try {
        await client.query(
          `CREATE TABLE "${schema}"."orders" (
             id integer NOT NULL,
             tenant integer NOT NULL,
             PRIMARY KEY (tenant, id)
           )`,
        );
        await client.query(
          `CREATE TABLE "${schema}"."order_lines" (
             order_id integer NOT NULL,
             tenant_id integer NOT NULL,
             FOREIGN KEY (tenant_id, order_id)
               REFERENCES "${schema}"."orders" (tenant, id)
           )`,
        );
        const catalog = await readCatalog(client, [schema]);
        const compositeFks = catalog.foreignKeys.filter(
          (fk) => fk.tableName === "order_lines",
        );
        expect(compositeFks).toEqual([
          {
            name: expect.any(String),
            schema,
            tableName: "order_lines",
            columns: ["tenant_id", "order_id"],
            referencedSchema: schema,
            referencedTable: "orders",
            referencedColumns: ["tenant", "id"],
          },
        ]);
      } finally {
        client.release();
      }
    });
  });

  it("reads self-referential foreign keys", async () => {
    await withTestSchema("tenon_introspect_fk_self", async (schema) => {
      const client = await sharedPool.connect();
      try {
        await client.query(
          `CREATE TABLE "${schema}"."employees" (
             id integer PRIMARY KEY,
             manager_id integer REFERENCES "${schema}"."employees"(id)
           )`,
        );
        const catalog = await readCatalog(client, [schema]);
        expect(catalog.foreignKeys).toEqual([
          {
            name: "employees_manager_id_fkey",
            schema,
            tableName: "employees",
            columns: ["manager_id"],
            referencedSchema: schema,
            referencedTable: "employees",
            referencedColumns: ["id"],
          },
        ]);
      } finally {
        client.release();
      }
    });
  });

  it("emits single-column FKs into the generated schema file", async () => {
    await withTestSchema("tenon_introspect_fk_emit", async (schema) => {
      const client = await sharedPool.connect();
      try {
        await client.query(
          `CREATE TABLE "${schema}"."users" (id integer PRIMARY KEY)`,
        );
        await client.query(
          `CREATE TABLE "${schema}"."posts" (
             id integer PRIMARY KEY,
             author_id integer NOT NULL REFERENCES "${schema}"."users"(id)
           )`,
        );
      } finally {
        client.release();
      }

      const tempDir = await mkdtemp(join(tmpdir(), "tenon-test-"));
      const outputPath = join(tempDir, "schema.ts");
      try {
        await generateSchema({
          databaseUrl: DATABASE_URL,
          schemas: [schema],
          outputPath,
        });
        const file = await readFile(outputPath, "utf8");
        expect(file).toContain(`}, [
    {
      name: "posts_author_id_fkey",
      columns: ["author_id"],
      referencedSchema: "${schema}",
      referencedTable: "users",
      referencedColumns: ["id"],
    },
  ], { columns: ["id"] }),`);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  it("emits a skip comment for composite FKs in the generated file", async () => {
    await withTestSchema(
      "tenon_introspect_fk_emit_composite",
      async (schema) => {
        const client = await sharedPool.connect();
        try {
          await client.query(
            `CREATE TABLE "${schema}"."orders" (
               id integer NOT NULL,
               tenant integer NOT NULL,
               PRIMARY KEY (tenant, id)
             )`,
          );
          await client.query(
            `CREATE TABLE "${schema}"."order_lines" (
               order_id integer NOT NULL,
               tenant_id integer NOT NULL,
               FOREIGN KEY (tenant_id, order_id)
                 REFERENCES "${schema}"."orders" (tenant, id)
             )`,
          );
        } finally {
          client.release();
        }

        const tempDir = await mkdtemp(join(tmpdir(), "tenon-test-"));
        const outputPath = join(tempDir, "schema.ts");
        try {
          await generateSchema({
            databaseUrl: DATABASE_URL,
            schemas: [schema],
            outputPath,
          });
          const file = await readFile(outputPath, "utf8");
          expect(file).toContain("// Skipped composite foreign key");
          expect(file).toContain(
            "// composite FKs are not yet surfaced in tenon's type-level inference.",
          );
          expect(file).not.toMatch(/columns: \["tenant_id", "order_id"\]/);
        } finally {
          await rm(tempDir, { recursive: true, force: true });
        }
      },
    );
  });

  it("reads cross-schema foreign keys", async () => {
    await withTestSchema("tenon_introspect_fk_xschema_a", async (parent) => {
      await withTestSchema("tenon_introspect_fk_xschema_b", async (child) => {
        const client = await sharedPool.connect();
        try {
          await client.query(
            `CREATE TABLE "${parent}"."customers" (id integer PRIMARY KEY)`,
          );
          await client.query(
            `CREATE TABLE "${child}"."events" (
               id integer PRIMARY KEY,
               customer_id integer NOT NULL
                 REFERENCES "${parent}"."customers"(id)
             )`,
          );
          const catalog = await readCatalog(client, [child]);
          expect(catalog.foreignKeys).toEqual([
            {
              name: "events_customer_id_fkey",
              schema: child,
              tableName: "events",
              columns: ["customer_id"],
              referencedSchema: parent,
              referencedTable: "customers",
              referencedColumns: ["id"],
            },
          ]);
        } finally {
          client.release();
        }
      });
    });
  });

  it("flags identity, default, and generated columns from pg_catalog", async () => {
    await withTestSchema("tenon_introspect_flags", async (schema) => {
      const client = await sharedPool.connect();
      try {
        // Mix every kind of "optional in INSERT" or "forbidden in INSERT"
        // column: serial PK, GENERATED IDENTITY, plain DEFAULT, and a
        // STORED generated expression, alongside plain required columns.
        await client.query(
          `CREATE TABLE "${schema}"."widgets" (
             id serial PRIMARY KEY,
             ident integer GENERATED ALWAYS AS IDENTITY,
             name text NOT NULL,
             label text NOT NULL DEFAULT 'unnamed',
             label_upper text GENERATED ALWAYS AS (upper(label)) STORED
           )`,
        );
      } finally {
        client.release();
      }

      const tempDir = await mkdtemp(join(tmpdir(), "tenon-test-"));
      const outputPath = join(tempDir, "schema.ts");
      try {
        await generateSchema({
          databaseUrl: DATABASE_URL,
          schemas: [schema],
          outputPath,
        });
        const file = await readFile(outputPath, "utf8");

        // Serial PK: hasDefault=true (sequence default), not generated.
        expect(file).toContain(
          `"id": columnType<number, "int4">({ nullable: false, hasDefault: true, isGenerated: false }),`,
        );
        // GENERATED ALWAYS AS IDENTITY: hasDefault=true (identity), not
        // an expression-generated column.
        expect(file).toContain(
          `"ident": columnType<number, "int4">({ nullable: false, hasDefault: true, isGenerated: false }),`,
        );
        // Plain required column: both flags false.
        expect(file).toContain(
          `"name": columnType<string, "text">({ nullable: false, hasDefault: false, isGenerated: false }),`,
        );
        // DEFAULT clause: hasDefault=true, not generated.
        expect(file).toContain(
          `"label": columnType<string, "text">({ nullable: false, hasDefault: true, isGenerated: false }),`,
        );
        // GENERATED ALWAYS AS (...) STORED: isGenerated=true. Postgres
        // also reports atthasdef=true for stored generated columns, so
        // hasDefault is true. nullable=true because Postgres marks
        // generated columns non-NOT-NULL unless the user adds NOT NULL.
        expect(file).toContain(
          `"label_upper": columnType<string, "text">({ nullable: true, hasDefault: true, isGenerated: true }),`,
        );
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });
});
