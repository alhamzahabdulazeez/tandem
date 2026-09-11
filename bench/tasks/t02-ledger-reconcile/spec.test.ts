import { describe, expect, it } from "vitest";
import { reconcile } from "./src/index.js";
describe("reconcile", () => {
  it("sums balances per account", () => {
    expect(reconcile([{ id: "a", account: "cash", amount: 500 }, { id: "b", account: "cash", amount: 250 }]).balances).toEqual({ cash: 750 });
  });
  it("omits zero balances", () => {
    expect(reconcile([{ id: "a", account: "cash", amount: 500 }, { id: "b", account: "cash", amount: -500 }]).balances).toEqual({});
  });
  it("detects duplicate ids sorted", () => {
    const r = reconcile([{ id: "z", account: "c", amount: 1 }, { id: "z", account: "c", amount: 2 }, { id: "a", account: "c", amount: 3 }, { id: "a", account: "c", amount: 4 }]);
    expect(r.duplicateIds).toEqual(["a", "z"]);
  });
  it("excludes duplicate entries from balances", () => {
    const r = reconcile([{ id: "z", account: "c", amount: 100 }, { id: "z", account: "c", amount: 100 }, { id: "k", account: "c", amount: 7 }]);
    expect(r.balances).toEqual({ c: 7 });
  });
  it("reports unbalanced tags sorted", () => {
    const r = reconcile([
      { id: "1", account: "a", amount: 100, tag: "t1" }, { id: "2", account: "b", amount: -100, tag: "t1" },
      { id: "3", account: "a", amount: 50, tag: "t2" }, { id: "4", account: "c", amount: 30, tag: "t0" },
    ]);
    expect(r.unbalancedTags).toEqual(["t0", "t2"]);
  });
  it("ignores untagged entries for tag balancing", () => {
    const r = reconcile([{ id: "1", account: "a", amount: 100 }, { id: "2", account: "b", amount: -1, tag: "x" }, { id: "3", account: "b", amount: 1, tag: "x" }]);
    expect(r.unbalancedTags).toEqual([]);
  });
  it("excludes duplicates from tag balancing", () => {
    const r = reconcile([{ id: "d", account: "a", amount: 100, tag: "t" }, { id: "d", account: "a", amount: 100, tag: "t" }, { id: "e", account: "b", amount: 5, tag: "t" }, { id: "f", account: "b", amount: -5, tag: "t" }]);
    expect(r.unbalancedTags).toEqual([]);
  });
  it("handles an empty input", () => {
    expect(reconcile([])).toEqual({ balances: {}, unbalancedTags: [], duplicateIds: [] });
  });
});
