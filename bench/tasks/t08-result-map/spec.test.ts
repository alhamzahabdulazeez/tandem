import { describe, expect, it } from "vitest";
import { ok, err, map, unwrap } from "./src/util/result.js";
import { Store } from "./src/core/store.js";
import { putHandler } from "./src/api/handlers.js";
describe("map", () => {
  it("applies the function to an ok value", () => { expect(map(ok(2), (n) => n * 3)).toEqual({ ok: true, value: 6 }); });
  it("changes the value type", () => { expect(map(ok(2), (n) => String(n))).toEqual({ ok: true, value: "2" }); });
  it("passes an error through unchanged", () => { expect(map(err<number>("bad"), (n) => n * 2)).toEqual({ ok: false, error: "bad" }); });
  it("does not call the function on an error", () => { let called = false; map(err<number>("x"), () => { called = true; return 1; }); expect(called).toBe(false); });
  it("leaves unwrap working", () => { expect(unwrap(err<number>("x"), 7)).toBe(7); });
  it("leaves Store and putHandler working", () => { const s = new Store(); expect(putHandler(s, { id: "a", value: 1, updatedAt: 0 })).toContain("stored"); expect(s.size()).toBe(1); });
});
