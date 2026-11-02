import { describe, expect, it } from "vitest";
import { findReferencedTables } from "./sqlCompletions";

describe("findReferencedTables", () => {
  it("maps a bare table name to itself", () => {
    expect(findReferencedTables("SELECT * FROM orders")).toEqual(new Map([["orders", "orders"]]));
  });

  it("maps an aliased table under both the alias and the table name", () => {
    const refs = findReferencedTables("SELECT o.id FROM orders o JOIN customers AS c ON o.customer_id = c.id");
    expect(refs.get("orders")).toBe("orders");
    expect(refs.get("o")).toBe("orders");
    expect(refs.get("customers")).toBe("customers");
    expect(refs.get("c")).toBe("customers");
  });

  it("strips a schema qualifier from the table name", () => {
    const refs = findReferencedTables("SELECT * FROM app.orders");
    expect(refs.get("orders")).toBe("orders");
  });

  it("ignores clause keywords that look like a trailing alias", () => {
    const refs = findReferencedTables("SELECT * FROM orders\nWHERE id = 1");
    expect(refs.has("where")).toBe(false);
    expect(refs.get("orders")).toBe("orders");
  });

  it("returns an empty map when no table is referenced", () => {
    expect(findReferencedTables("SELECT 1").size).toBe(0);
  });
});
