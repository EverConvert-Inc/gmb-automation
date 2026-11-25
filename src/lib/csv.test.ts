import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csvCell", () => {
  it("leaves plain text and numbers alone", () => {
    expect(csvCell("Acme Law")).toBe("Acme Law");
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell(-120)).toBe("-120");
  });
  it("blanks null, undefined and non-finite numbers", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(Number.NaN)).toBe("");
  });
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("Smith, Jones")).toBe('"Smith, Jones"');
    expect(csvCell('the "best"')).toBe('"the ""best"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });
  it("defuses text that a spreadsheet would run as a formula", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-Brand")).toBe("'-Brand");
    expect(csvCell("@x,y")).toBe("\"'@x,y\"");
  });
});

describe("toCsv", () => {
  it("joins a header and rows with CRLF", () => {
    expect(toCsv(["a", "b"], [[1, "x"], [null, "y,z"]])).toBe('a,b\r\n1,x\r\n,"y,z"\r\n');
  });
});
