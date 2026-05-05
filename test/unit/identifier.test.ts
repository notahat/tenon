import { describe, expect, it } from "vitest";

import { quoteIdent } from "../../src/sql/identifier.js";

describe("quoteIdent", () => {
  it("wraps a simple lowercase identifier in double quotes", () => {
    expect(quoteIdent("users")).toBe(`"users"`);
  });

  it("preserves mixed case so Postgres treats it as case-sensitive", () => {
    expect(quoteIdent("UserAccounts")).toBe(`"UserAccounts"`);
  });

  it("escapes embedded double quotes by doubling them", () => {
    expect(quoteIdent(`weird"name`)).toBe(`"weird""name"`);
  });

  it("preserves spaces inside the identifier", () => {
    expect(quoteIdent("two words")).toBe(`"two words"`);
  });

  it("preserves unicode characters", () => {
    expect(quoteIdent("café")).toBe(`"café"`);
  });
});
