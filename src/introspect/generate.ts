// High-level orchestrator for schema generation. Connects to the
// database, reads pg_catalog, builds the file string, and writes it
// to disk. Exposed as a programmatic API so tests can drive the same
// codepath as the CLI.
//
// Out of scope: argument parsing (src/introspect/bin.ts).

import { writeFile } from "node:fs/promises";

import pg from "pg";

import { emitSchemaFile } from "./emit.js";
import { readCatalog } from "./readCatalog.js";

export interface GenerateOptions {
  readonly databaseUrl: string;
  readonly schemas: readonly string[];
  readonly outputPath: string;
}

/**
 * Connect to the given database, introspect the listed schemas, and
 * write a TypeScript schema file to outputPath. The database
 * connection is fully closed before this function returns.
 */
export async function generateSchema(options: GenerateOptions): Promise<void> {
  const client = new pg.Client({ connectionString: options.databaseUrl });
  await client.connect();
  try {
    const { columns, foreignKeys, primaryKeys } = await readCatalog(
      client,
      options.schemas,
    );
    const fileContents = emitSchemaFile(columns, foreignKeys, primaryKeys);
    await writeFile(options.outputPath, fileContents, "utf8");
  } finally {
    await client.end();
  }
}
