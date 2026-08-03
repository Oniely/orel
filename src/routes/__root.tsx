import { createRootRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { SettingsModal } from "../components/SettingsModal";
import { initTheme } from "../stores/theme.store";
import { useSettingsStore } from "../stores/settings.store";
import { useAppInfo, useAppUpdate } from "../hooks/useAppUpdate";
import "../global.css";

// Apply theme immediately (before React renders) to prevent flash
initTheme();

const RootLayout = () => {
  const openSettings = useSettingsStore((state) => state.openSettings);
  useAppUpdate();
  useAppInfo();

  useEffect(() => {
    const unlisten = listen("open-settings", () => {
      openSettings("appearance");
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [openSettings]);

  return (
    <>
      <Outlet />
      <SettingsModal />
      {/*<TanStackRouterDevtools />*/}
    </>
  );
};

export const Route = createRootRoute({ component: RootLayout });
