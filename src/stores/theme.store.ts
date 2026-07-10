import { create } from "zustand";
import { THEMES, applyTheme } from "../lib/themes";

const STORAGE_KEY = "orel-theme";

interface ThemeStore {
  themeId: string;
  setTheme: (id: string) => void;
}

export const useThemeStore = create<ThemeStore>((set) => ({
  themeId: localStorage.getItem(STORAGE_KEY) ?? "dark",

  setTheme: (id) => {
    const theme = THEMES.find((t) => t.id === id);
    if (!theme) return;
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, id);
    set({ themeId: id });
  },
}));

/**
 * Call once on app startup to apply the persisted theme.
 */
export function initTheme(): void {
  const id = localStorage.getItem(STORAGE_KEY) ?? "dark";
  const theme = THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === "dark")!;
  applyTheme(theme);
}
