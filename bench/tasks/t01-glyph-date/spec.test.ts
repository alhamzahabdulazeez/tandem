import { describe, expect, it } from "vitest";
import { parseGlyphDate } from "./src/index.js";
describe("parseGlyphDate", () => {
  it("parses a basic glyph date", () => { expect(parseGlyphDate("05C2026")).toEqual({ year: 2026, month: 3, day: 5 }); });
  it("is case-insensitive", () => { expect(parseGlyphDate("05c2026")).toEqual({ year: 2026, month: 3, day: 5 }); });
  it("handles month L", () => { expect(parseGlyphDate("31L1999")).toEqual({ year: 1999, month: 12, day: 31 }); });
  it("applies an offset within the month", () => { expect(parseGlyphDate("05C2026~10")).toEqual({ year: 2026, month: 3, day: 15 }); });
  it("applies an offset across a month boundary", () => { expect(parseGlyphDate("28B2026~5")).toEqual({ year: 2026, month: 3, day: 5 }); });
  it("applies an offset across a year boundary", () => { expect(parseGlyphDate("31L2025~1")).toEqual({ year: 2026, month: 1, day: 1 }); });
  it("accepts 29 February in a leap year", () => { expect(parseGlyphDate("29B2024")).toEqual({ year: 2024, month: 2, day: 29 }); });
  it("rejects 29 February in a non-leap year", () => { expect(parseGlyphDate("29B2026")).toBeNull(); });
  it("rejects 31 April", () => { expect(parseGlyphDate("31D2026")).toBeNull(); });
  it("rejects an unknown month letter", () => { expect(parseGlyphDate("05M2026")).toBeNull(); });
  it("rejects a 1-digit day", () => { expect(parseGlyphDate("5C2026")).toBeNull(); });
  it("rejects a 4-digit offset", () => { expect(parseGlyphDate("05C2026~1000")).toBeNull(); });
  it("rejects trailing junk", () => { expect(parseGlyphDate("05C2026x")).toBeNull(); });
  it("rejects an empty string", () => { expect(parseGlyphDate("")).toBeNull(); });
});
