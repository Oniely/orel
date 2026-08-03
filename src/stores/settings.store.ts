import { create } from "zustand";

export type SettingsSection = "appearance" | "updates";

interface SettingsStore {
  isOpen: boolean;
  section: SettingsSection;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  setSection: (section: SettingsSection) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  isOpen: false,
  section: "appearance",
  openSettings: (section = "appearance") => set({ isOpen: true, section }),
  closeSettings: () => set({ isOpen: false }),
  setSection: (section) => set({ section }),
}));
