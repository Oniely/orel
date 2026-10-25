import { create } from "zustand";

// Persisted widths of the dashboard's side panels (table sidebar + row inspector).

const STORAGE_KEY = "orel-layout";

export const SIDEBAR_WIDTH_RANGE = { min: 200, max: 480, default: 248 };
export const INSPECTOR_WIDTH_RANGE = { min: 280, max: 720, default: 340 };

interface PanelWidths {
  sidebarWidth: number;
  inspectorWidth: number;
}

interface LayoutStore extends PanelWidths {
  setSidebarWidth: (width: number) => void;
  setInspectorWidth: (width: number) => void;
}

export function clampWidth(width: number, range: { min: number; max: number }): number {
  return Math.round(Math.min(range.max, Math.max(range.min, width)));
}

function loadWidths(): PanelWidths {
  let saved: Partial<PanelWidths> = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    // Corrupt value — fall back to defaults
  }
  return {
    sidebarWidth: clampWidth(Number(saved.sidebarWidth) || SIDEBAR_WIDTH_RANGE.default, SIDEBAR_WIDTH_RANGE),
    inspectorWidth: clampWidth(Number(saved.inspectorWidth) || INSPECTOR_WIDTH_RANGE.default, INSPECTOR_WIDTH_RANGE),
  };
}

export const useLayoutStore = create<LayoutStore>((set) => ({
  ...loadWidths(),
  setSidebarWidth: (width) => set({ sidebarWidth: clampWidth(width, SIDEBAR_WIDTH_RANGE) }),
  setInspectorWidth: (width) => set({ inspectorWidth: clampWidth(width, INSPECTOR_WIDTH_RANGE) }),
}));

useLayoutStore.subscribe(({ sidebarWidth, inspectorWidth }) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ sidebarWidth, inspectorWidth }));
});
