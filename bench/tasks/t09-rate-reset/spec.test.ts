import { describe, expect, it } from "vitest";
import { RateWindow } from "./src/core/rates.js";
import type { Clock } from "./src/util/clock.js";
const fixed = (t: number): Clock => ({ now: () => t });
describe("RateWindow", () => {
  it("still blocks past the limit", () => { const w = new RateWindow(fixed(0), 1000, 2); expect(w.allow()).toBe(true); expect(w.allow()).toBe(true); expect(w.allow()).toBe(false); });
  it("reset clears hits", () => { const w = new RateWindow(fixed(0), 1000, 2); w.allow(); w.allow(); w.reset(); expect(w.allow()).toBe(true); });
  it("usedRatio is zero when unused", () => { expect(new RateWindow(fixed(0), 1000, 4).usedRatio()).toBe(0); });
  it("usedRatio reflects usage", () => { const w = new RateWindow(fixed(0), 1000, 4); w.allow(); w.allow(); expect(w.usedRatio()).toBe(0.5); });
  it("usedRatio is one at the limit", () => { const w = new RateWindow(fixed(0), 1000, 2); w.allow(); w.allow(); expect(w.usedRatio()).toBe(1); });
  it("remaining still works", () => { const w = new RateWindow(fixed(0), 1000, 3); w.allow(); expect(w.remaining()).toBe(2); });
});
