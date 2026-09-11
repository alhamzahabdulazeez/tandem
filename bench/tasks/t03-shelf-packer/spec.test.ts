import { describe, expect, it } from "vitest";
import { packShelves } from "./src/index.js";
describe("packShelves", () => {
  it("packs items that all fit on one shelf", () => { expect(packShelves([1, 2, 3], 10)).toEqual([[1, 2, 3]]); });
  it("opens a new shelf when full", () => { expect(packShelves([4, 4, 4], 8)).toEqual([[4, 4], [4]]); });
  it("does not backfill an earlier shelf", () => { expect(packShelves([5, 4, 1], 6)).toEqual([[5], [4, 1]]); });
  it("gives an oversized item its own shelf", () => { expect(packShelves([12, 2], 5)).toEqual([[12], [2]]); });
  it("handles exact fits", () => { expect(packShelves([3, 3, 3], 3)).toEqual([[3], [3], [3]]); });
  it("returns an empty array for empty input", () => { expect(packShelves([], 5)).toEqual([]); });
  it("throws on zero capacity", () => { expect(() => packShelves([1], 0)).toThrow(RangeError); });
  it("throws on fractional capacity", () => { expect(() => packShelves([1], 2.5)).toThrow(RangeError); });
});
