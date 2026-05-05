// Postgres typname -> TypeScript type mapping used during schema
// generation. The map is intentionally small and explicit; unknown
// types fall back to `string` and are flagged so the generator can
// emit a comment alerting the user.
//
// Out of scope: runtime parsing of Postgres values (we trust pg's
// built-in parsers); custom user-supplied parsers (a future escape
// hatch).

interface MappedType {
  /** TypeScript type as it should appear in the generated file. */
  readonly tsType: string;
  /** Postgres typname; round-trips into the generated `<TS, "tag">`. */
  readonly sqlTag: string;
  /** True when the type was unrecognised and fell back to `string`. */
  readonly isFallback: boolean;
}

const SCALAR_TS_TYPE: Readonly<Record<string, string>> = {
  bool: "boolean",
  int2: "number",
  int4: "number",
  int8: "string",
  float4: "number",
  float8: "number",
  numeric: "string",
  text: "string",
  varchar: "string",
  char: "string",
  bpchar: "string",
  name: "string",
  uuid: "string",
  date: "string",
  time: "string",
  timetz: "string",
  timestamp: "string",
  timestamptz: "Date",
  bytea: "Buffer",
  json: "unknown",
  jsonb: "unknown",
};

/**
 * Map a Postgres `typname` (as found in pg_type) to a MappedType.
 * Array types in Postgres carry an underscore prefix on their typname
 * (e.g. `_int4` for `int4[]`); these are recognised and the element
 * type is wrapped in `T[]`.
 */
export function mapPostgresType(typname: string): MappedType {
  if (typname.startsWith("_")) {
    const element = mapPostgresType(typname.slice(1));
    return {
      tsType: `${element.tsType}[]`,
      sqlTag: typname,
      isFallback: element.isFallback,
    };
  }
  const scalar = SCALAR_TS_TYPE[typname];
  if (scalar !== undefined) {
    return { tsType: scalar, sqlTag: typname, isFallback: false };
  }
  return { tsType: "string", sqlTag: typname, isFallback: true };
}
