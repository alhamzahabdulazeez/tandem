import { describe, expect, it } from "vitest";
import { Store } from "./src/core/store.js";
import { summarise, topN } from "./src/api/report.js";
const seed = () => { const s = new Store();
  s.put({ id: "b", value: 5, updatedAt: 0 });
  s.put({ id: "a", value: 5, updatedAt: 0 });
  s.put({ id: "c", value: 9, updatedAt: 0 });
  s.put({ id: "d", value: 1, updatedAt: 0 }); return s; };
describe("topN", () => {
  it("returns the highest values first", () => { expect(topN(seed(), 2).map((r) => r.id)).toEqual(["c", "a"]); });
  it("breaks ties by id ascending", () => { expect(topN(seed(), 3).map((r) => r.id)).toEqual(["c", "a", "b"]); });
  it("returns everything when n exceeds the size", () => { expect(topN(seed(), 99).length).toBe(4); });
  it("returns an empty array for zero", () => { expect(topN(seed(), 0)).toEqual([]); });
  it("returns an empty array for a negative n", () => { expect(topN(seed(), -1)).toEqual([]); });
  it("leaves summarise unchanged", () => { expect(summarise(seed())).toEqual({ count: 4, total: 20 }); });
});
