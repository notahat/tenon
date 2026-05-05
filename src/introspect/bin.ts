#!/usr/bin/env node
// CLI entry point for `trel-generate`. Parses three flags and
// delegates to generateSchema. Kept minimal: no config file, no
// inclusion / exclusion filters beyond the schema list. Add
// surface area only when a second consumer requests it.

import { generateSchema } from "./generate.js";

const USAGE = `Usage: trel-generate \\
  --database-url <postgres-url> \\
  [--schemas public[,other]] \\
  --output <path-to.ts>
`;

interface ParsedArgs {
  readonly databaseUrl: string;
  readonly schemas: readonly string[];
  readonly outputPath: string;
}

/** Parse argv into structured options or throw a helpful error. */
function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === undefined || !arg.startsWith("--")) continue;
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new Error(`Flag ${arg} requires a value.`);
    }
    flags.set(arg.slice(2), next);
    index += 1;
  }

  const databaseUrl = flags.get("database-url");
  const outputPath = flags.get("output");
  if (databaseUrl === undefined) {
    throw new Error("Missing required flag --database-url.");
  }
  if (outputPath === undefined) {
    throw new Error("Missing required flag --output.");
  }

  const schemasRaw = flags.get("schemas") ?? "public";
  const schemas = schemasRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (schemas.length === 0) {
    throw new Error("--schemas must include at least one schema name.");
  }

  return { databaseUrl, schemas, outputPath };
}

async function main(): Promise<void> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\n${USAGE}`);
    process.exit(2);
  }

  await generateSchema(parsed);
  process.stdout.write(
    `Wrote schema for [${parsed.schemas.join(", ")}] to ${parsed.outputPath}\n`,
  );
}

await main();
