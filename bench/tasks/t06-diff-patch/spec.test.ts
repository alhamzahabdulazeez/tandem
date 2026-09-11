import { describe, expect, it } from "vitest";
import { applyPatch } from "./src/index.js";
describe("applyPatch", () => {
  it("inserts without removing", () => { expect(applyPatch(["a", "b"], [{ at: 1, remove: 0, insert: ["x"] }])).toEqual(["a", "x", "b"]); });
  it("removes without inserting", () => { expect(applyPatch(["a", "b", "c"], [{ at: 1, remove: 1, insert: [] }])).toEqual(["a", "c"]); });
  it("replaces", () => { expect(applyPatch(["a", "b", "c"], [{ at: 1, remove: 1, insert: ["x", "y"] }])).toEqual(["a", "x", "y", "c"]); });
  it("uses original indices for multiple ops", () => {
    expect(applyPatch(["a", "b", "c", "d"], [{ at: 0, remove: 1, insert: ["1", "2"] }, { at: 2, remove: 1, insert: ["3"] }])).toEqual(["1", "2", "b", "3", "d"]);
  });
  it("appends at the end", () => { expect(applyPatch(["a"], [{ at: 1, remove: 0, insert: ["b"] }])).toEqual(["a", "b"]); });
  it("does not mutate the input", () => { const src = ["a", "b"]; applyPatch(src, [{ at: 0, remove: 1, insert: [] }]); expect(src).toEqual(["a", "b"]); });
  it("throws on overlapping ops", () => { expect(() => applyPatch(["a", "b", "c"], [{ at: 0, remove: 2, insert: [] }, { at: 1, remove: 1, insert: [] }])).toThrow(RangeError); });
  it("throws when at is out of range", () => { expect(() => applyPatch(["a"], [{ at: 5, remove: 0, insert: [] }])).toThrow(RangeError); });
  it("throws when the removal runs past the end", () => { expect(() => applyPatch(["a"], [{ at: 0, remove: 3, insert: [] }])).toThrow(RangeError); });
  it("handles an empty patch", () => { expect(applyPatch(["a"], [])).toEqual(["a"]); });
});
