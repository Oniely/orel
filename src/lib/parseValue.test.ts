import { describe, expect, it } from "vitest";
import {
  formatEditValue,
  formatJsonForEditor,
  isJsonValue,
  isLongText,
  jsonEditError,
  parseEditValue,
} from "./parseValue";

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

describe("JSON detection", () => {
  it("detects JSON by column type or by an object/array value", () => {
    expect(isJsonValue("jsonb", null)).toBe(true);
    expect(isJsonValue("JSON", '{"a":1}')).toBe(true);
    expect(isJsonValue("text", { a: 1 })).toBe(true);
    expect(isJsonValue("text", '{"a":1}')).toBe(false);
    expect(isJsonValue("jsonb[]", null)).toBe(false);
  });

  it("flags long or multi-line text values only for text-ish types", () => {
    expect(isLongText("varchar", "x".repeat(81))).toBe(true);
    expect(isLongText("longtext", "a\nb")).toBe(true);
    expect(isLongText("text", "short")).toBe(false);
    expect(isLongText("integer", "x".repeat(81))).toBe(false);
    expect(isLongText("text", null)).toBe(false);
  });
});

describe("JSON editor formatting", () => {
  it("pretty-prints objects and JSON text with 2-space indent", () => {
    expect(formatJsonForEditor({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}');
    expect(formatJsonForEditor('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(formatJsonForEditor(null)).toBe("");
    expect(formatJsonForEditor("{oops")).toBe("{oops");
  });
});

describe("JSON edit validation", () => {
  it("accepts valid JSON and NULL on nullable columns", () => {
    expect(jsonEditError('{"a":1}', false)).toBeNull();
    expect(jsonEditError("  ", true)).toBeNull();
    expect(jsonEditError("NULL", true)).toBeNull();
  });

  it("reports the message and line/column of invalid JSON", () => {
    const error = jsonEditError('{\n  "a" 1\n}', true);
    expect(error).toMatchObject({ line: 2, column: 7 });
    expect(error?.message).not.toMatch(/position/);
  });

  it("rejects empty text on a non-nullable column", () => {
    expect(jsonEditError("", false)).not.toBeNull();
  });
});

describe("JSON edits held as text (SQLite)", () => {
  const original = '{"a":1,"b":[2]}';

  it("returns the original string when the edit only reformats it", () => {
    expect(parseEditValue('{\n  "a": 1,\n  "b": [2]\n}', "json", true, original)).toBe(original);
  });

  it("stages changed JSON as text, not a parsed object", () => {
    expect(parseEditValue('{"a":2}', "json", true, original)).toBe('{"a":2}');
    expect(parseEditValue('{"a":2}', "jsonb", true, null)).toBe('{"a":2}');
  });

  it("keeps a bare JSON string quoted on object-valued columns", () => {
    expect(parseEditValue('"hi"', "jsonb", true, { a: 1 })).toBe('"hi"');
  });

  it("matches an unchanged pretty-printed object semantically", () => {
    const value = { a: 1, tags: ["x"] };
    expect(parseEditValue(formatJsonForEditor(value), "jsonb", true, value)).toEqual(value);
  });
});
