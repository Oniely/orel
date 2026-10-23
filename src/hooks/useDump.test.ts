import { describe, expect, it } from "vitest";
import { toImportError } from "./useDump";

describe("toImportError", () => {
  it("keeps the structured fields from import_sql_dump", () => {
    const error = { message: "syntax error", line: 12, snippet: "CREATE TABL x", hint: "Looks like MySQL" };
    expect(toImportError(error)).toEqual(error);
  });

  it("fills missing optional fields with null", () => {
    expect(toImportError({ message: "boom" })).toEqual({ message: "boom", line: null, snippet: null, hint: null });
  });

  it("wraps a plain string rejection", () => {
    expect(toImportError("connection lost")).toEqual({
      message: "connection lost",
      line: null,
      snippet: null,
      hint: null,
    });
  });

  it("falls back to a generic message", () => {
    expect(toImportError(undefined).message).toBe("Import failed");
  });
});
