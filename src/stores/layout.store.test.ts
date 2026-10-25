import { beforeEach, describe, expect, it } from "vitest";
import { INSPECTOR_WIDTH_RANGE, SIDEBAR_WIDTH_RANGE, clampWidth, useLayoutStore } from "./layout.store";

describe("layout store", () => {
  beforeEach(() => {
    useLayoutStore.setState({
      sidebarWidth: SIDEBAR_WIDTH_RANGE.default,
      inspectorWidth: INSPECTOR_WIDTH_RANGE.default,
    });
  });

  it("clamps widths to the allowed range", () => {
    expect(clampWidth(10, SIDEBAR_WIDTH_RANGE)).toBe(SIDEBAR_WIDTH_RANGE.min);
    expect(clampWidth(9999, SIDEBAR_WIDTH_RANGE)).toBe(SIDEBAR_WIDTH_RANGE.max);
    expect(clampWidth(300.6, SIDEBAR_WIDTH_RANGE)).toBe(301);
  });

  it("clamps when setting panel widths", () => {
    useLayoutStore.getState().setSidebarWidth(50);
    useLayoutStore.getState().setInspectorWidth(5000);
    expect(useLayoutStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_RANGE.min);
    expect(useLayoutStore.getState().inspectorWidth).toBe(INSPECTOR_WIDTH_RANGE.max);
  });

  it("persists widths to localStorage", () => {
    useLayoutStore.getState().setSidebarWidth(320);
    useLayoutStore.getState().setInspectorWidth(400);
    expect(JSON.parse(localStorage.getItem("orel-layout") ?? "{}")).toEqual({
      sidebarWidth: 320,
      inspectorWidth: 400,
    });
  });
});
