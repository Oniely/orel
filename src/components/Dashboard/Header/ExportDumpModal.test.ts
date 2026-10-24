import { describe, expect, it } from "vitest";
import { sanitizeFilenamePart } from "./ExportDumpModal";

describe("sanitizeFilenamePart", () => {
  it("leaves ordinary names alone", () => {
    expect(sanitizeFilenamePart("Orel Postgres")).toBe("Orel Postgres");
  });

  it("replaces characters illegal on Windows/macOS filenames", () => {
    expect(sanitizeFilenamePart('a/b\\c:d*e?f"g<h>i|j')).toBe("a_b_c_d_e_f_g_h_i_j");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeFilenamePart("  orel_dev  ")).toBe("orel_dev");
  });
});
