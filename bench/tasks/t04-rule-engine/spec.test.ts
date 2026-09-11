import { describe, expect, it } from "vitest";
import { evaluate } from "./src/index.js";
describe("evaluate", () => {
  it("fires a single matching rule", () => {
    const f = { temp: 30 };
    expect(evaluate([{ name: "hot", when: "temp > 25", then: "fan = 1" }], f)).toEqual(["hot"]);
    expect(f.fan).toBe(1);
  });
  it("does not fire when the condition is false", () => {
    expect(evaluate([{ name: "hot", when: "temp > 25", then: "fan = 1" }], { temp: 10 })).toEqual([]);
  });
  it("does not refire when the value is unchanged", () => {
    expect(evaluate([{ name: "hot", when: "temp > 25", then: "fan = 1" }], { temp: 30, fan: 1 })).toEqual([]);
  });
  it("respects priority", () => {
    const out = evaluate([
      { name: "low", when: "x > 0", then: "y = 1" },
      { name: "high", when: "x > 0", then: "y = 2", priority: 5 },
    ], { x: 1 });
    expect(out[0]).toBe("high");
  });
  it("breaks ties by index", () => {
    const out = evaluate([
      { name: "first", when: "x > 0", then: "y = 1" },
      { name: "second", when: "x > 0", then: "z = 1" },
    ], { x: 1 });
    expect(out).toEqual(["first", "second"]);
  });
  it("supports all operators", () => {
    expect(evaluate([{ name: "eq", when: "a == 5", then: "b = 1" }], { a: 5 })).toEqual(["eq"]);
    expect(evaluate([{ name: "ne", when: "a != 5", then: "b = 1" }], { a: 4 })).toEqual(["ne"]);
    expect(evaluate([{ name: "le", when: "a <= 5", then: "b = 1" }], { a: 5 })).toEqual(["le"]);
  });
  it("chains rules", () => {
    const out = evaluate([
      { name: "r1", when: "a > 0", then: "b = 1" },
      { name: "r2", when: "b > 0", then: "c = 1" },
    ], { a: 1 });
    expect(out).toEqual(["r1", "r2"]);
  });
  it("terminates on a cycle at 100 firings", () => {
    const out = evaluate([
      { name: "up", when: "x == 0", then: "x = 1" },
      { name: "down", when: "x == 1", then: "x = 0" },
    ], { x: 0 });
    expect(out.length).toBe(100);
  });
  it("throws on a malformed condition", () => {
    expect(() => evaluate([{ name: "bad", when: "temp >>> 5", then: "f = 1" }], {})).toThrow(SyntaxError);
  });
  it("throws on a malformed assignment", () => {
    expect(() => evaluate([{ name: "bad", when: "temp > 5", then: "f == 1" }], { temp: 10 })).toThrow(SyntaxError);
  });
});
