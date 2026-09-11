import { describe, expect, it } from "vitest";
import { Store } from "./src/core/store.js";
import { putHandler, getValue } from "./src/api/handlers.js";
import { summarise } from "./src/api/report.js";
describe("expire", () => {
  const seed = () => { const s = new Store();
    s.put({ id: "old", value: 1, updatedAt: 1000 });
    s.put({ id: "new", value: 2, updatedAt: 9000 }); return s; };
  it("removes only stale records", () => { const s = seed(); expect(s.expire(1000, 9500)).toBe(1); expect(s.size()).toBe(1); });
  it("keeps fresh records", () => { const s = seed(); s.expire(1000, 9500); expect(s.get("new").ok).toBe(true); });
  it("removes nothing when all are fresh", () => { const s = seed(); expect(s.expire(100000, 9500)).toBe(0); });
  it("does not break putHandler", () => { const s = new Store(); expect(putHandler(s, { id: "a", value: 1, updatedAt: 0 })).toContain("stored"); });
  it("does not break getValue", () => { const s = seed(); expect(getValue(s, "missing", 42)).toBe(42); });
  it("does not break summarise", () => { const s = seed(); expect(summarise(s)).toEqual({ count: 2, total: 3 }); });
});
