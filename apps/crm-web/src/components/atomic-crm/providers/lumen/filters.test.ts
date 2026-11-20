import { describe, expect, it } from "vitest";

import { parseList, translateFilter } from "./filters";

describe("parseList", () => {
  it("reads plain and quoted items", () => {
    expect(parseList("(1,2, 3)", "(", ")")).toEqual(["1", "2", "3"]);
    expect(parseList('("Acme","Beta")', "(", ")")).toEqual(["Acme", "Beta"]);
    expect(parseList("()", "(", ")")).toEqual([]);
  });

  it("keeps commas and brackets inside quotes, and unescapes quotes and backslashes", () => {
    // What fetchRecordsWithCache sends for a CSV import's company names
    const literal = String.raw`("Acme \"Research\"","Back\\slash","Mixed\\\"Name","Comma, (Inc.)")`;
    expect(parseList(literal, "(", ")")).toEqual([
      'Acme "Research"',
      "Back\\slash",
      'Mixed\\"Name',
      "Comma, (Inc.)",
    ]);
  });

  it("keeps spaces inside quotes", () => {
    expect(parseList('(" padded ")', "(", ")")).toEqual([" padded "]);
  });
});

describe("translateFilter", () => {
  it("turns an @in literal into an array", () => {
    expect(translateFilter({ "name@in": '("Comma, Inc.","Beta")' })).toEqual({
      "name@in": ["Comma, Inc.", "Beta"],
    });
  });
});
