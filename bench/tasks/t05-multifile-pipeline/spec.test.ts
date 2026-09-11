import { describe, expect, it } from "vitest";
import { evaluateExpr, tokenize } from "./src/index.js";
describe("tokenize", () => {
  it("tokenizes a simple expression", () => {
    expect(tokenize("1 + 2").map((t) => t.kind)).toEqual(["num", "op", "num"]);
  });
  it("tokenizes parentheses", () => {
    expect(tokenize("(3)").map((t) => t.kind)).toEqual(["lparen", "num", "rparen"]);
  });
  it("throws on an illegal character", () => { expect(() => tokenize("1 $ 2")).toThrow(SyntaxError); });
});
describe("evaluateExpr", () => {
  it("adds", () => { expect(evaluateExpr("1 + 2")).toBe(3); });
  it("respects precedence", () => { expect(evaluateExpr("2 + 3 * 4")).toBe(14); });
  it("respects parentheses", () => { expect(evaluateExpr("(2 + 3) * 4")).toBe(20); });
  it("is left associative", () => { expect(evaluateExpr("10 - 3 - 2")).toBe(5); });
  it("truncates division toward zero", () => { expect(evaluateExpr("7 / 2")).toBe(3); });
  it("truncates negative division toward zero", () => { expect(evaluateExpr("0 - 7 / 2")).toBe(-3); });
  it("throws on division by zero", () => { expect(() => evaluateExpr("1 / 0")).toThrow(RangeError); });
});
