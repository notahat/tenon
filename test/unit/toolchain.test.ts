// Smoke test that proves the toolchain (TypeScript + Vitest) runs.
// Replace or remove once there is real behaviour to test.

import { describe, expect, it } from "vitest";

describe("toolchain", () => {
  it("runs a passing test", () => {
    expect(1 + 1).toBe(2);
  });
});
