import { describe, expect, it } from "vitest";

import { mapPostgresType } from "../../src/introspect/mapTypes.js";

describe("mapPostgresType", () => {
  it.each([
    ["int2", "number"],
    ["int4", "number"],
    ["int8", "string"],
    ["float4", "number"],
    ["float8", "number"],
    ["numeric", "string"],
    ["bool", "boolean"],
    ["text", "string"],
    ["varchar", "string"],
    ["bpchar", "string"],
    ["uuid", "string"],
    ["date", "string"],
    ["time", "string"],
    ["timetz", "string"],
    ["timestamp", "string"],
    ["timestamptz", "Date"],
    ["bytea", "Buffer"],
    ["json", "unknown"],
    ["jsonb", "unknown"],
  ] as const)("maps %s to TS %s", (typname, expected) => {
    expect(mapPostgresType(typname).tsType).toBe(expected);
  });

  it("returns the passed typname as the SQL tag", () => {
    expect(mapPostgresType("int4").sqlTag).toBe("int4");
    expect(mapPostgresType("text").sqlTag).toBe("text");
  });

  it("falls back to string for unknown typnames and flags it", () => {
    const result = mapPostgresType("citext");
    expect(result.tsType).toBe("string");
    expect(result.isFallback).toBe(true);
  });

  it("does not mark known types as a fallback", () => {
    expect(mapPostgresType("int4").isFallback).toBe(false);
  });

  it("recognises array types via the _ prefix and wraps element type", () => {
    const result = mapPostgresType("_int4");
    expect(result.tsType).toBe("number[]");
    expect(result.sqlTag).toBe("_int4");
    expect(result.isFallback).toBe(false);
  });

  it("falls back inside arrays of unknown element types", () => {
    const result = mapPostgresType("_citext");
    expect(result.tsType).toBe("string[]");
    expect(result.isFallback).toBe(true);
  });
});
