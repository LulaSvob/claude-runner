import { describe, it, expect } from "vitest";
import { deriveScope } from "../src/util/scope.js";

describe("deriveScope", () => {
  it("extracts US scope from user story names", () => {
    expect(deriveScope("us-1.2-foo-bar")).toBe("US-1.2");
    expect(deriveScope("us-10.3-some-feature")).toBe("US-10.3");
  });

  it("extracts TD scope from tech debt names", () => {
    expect(deriveScope("td-007-review-suggestions")).toBe("TD-007");
    expect(deriveScope("td-42-cleanup")).toBe("TD-42");
  });

  it("extracts B scope from bug names", () => {
    expect(deriveScope("b-042-fix-auth")).toBe("B-042");
    expect(deriveScope("b-1-quick-fix")).toBe("B-1");
  });

  it("returns name as-is for unrecognized patterns", () => {
    expect(deriveScope("some-random-name")).toBe("some-random-name");
    expect(deriveScope("feature-x")).toBe("feature-x");
  });
});
