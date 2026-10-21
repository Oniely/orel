import { describe, expect, it } from "vitest";
import { formatEditValue, parseEditValue } from "./parseValue";

describe("JSON cell edits", () => {
  const original = { a: 1, tags: ["x", "y"] };

  it("formats JSON objects/arrays as JSON text, not [object Object]", () => {
    expect(formatEditValue(original)).toBe('{"a":1,"tags":["x","y"]}');
    expect(formatEditValue([1, 2])).toBe("[1,2]");
    expect(formatEditValue(null)).toBe("");
    expect(formatEditValue(42)).toBe("42");
  });

  it("parses edited text back into JSON when the original was an object", () => {
    expect(parseEditValue('{"a":2}', "jsonb", true, original)).toEqual({ a: 2 });
  });

  it("round-trips an unchanged JSON value to an equal object", () => {
    expect(parseEditValue(formatEditValue(original), "json", true, original)).toEqual(original);
  });

  it("keeps invalid JSON as text and leaves string-valued columns alone", () => {
    expect(parseEditValue("{oops", "json", true, original)).toBe("{oops");
    expect(parseEditValue('{"a":1}', "json", true, '{"a":1}')).toBe('{"a":1}');
  });
});
