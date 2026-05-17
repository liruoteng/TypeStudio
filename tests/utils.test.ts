import { describe, it, expect } from "vitest";
import { cn } from "../src/lib/utils";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional class names", () => {
    expect(cn("base", false && "hidden", "visible")).toBe("base visible");
  });

  it("handles undefined and null values", () => {
    expect(cn("a", undefined, null, "b")).toBe("a b");
  });

  it("handles tailwind conflicts by merging (later wins)", () => {
    expect(cn("px-4", "px-2")).toBe("px-2");
  });

  it("handles empty input", () => {
    expect(cn()).toBe("");
  });

  it("handles array arguments", () => {
    expect(cn(["a", "b"], "c")).toBe("a b c");
  });
});
