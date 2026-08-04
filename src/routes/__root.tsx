import { createRootRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { SettingsModal } from "../components/SettingsModal";
import { initTheme } from "../stores/theme.store";
import { useSettingsStore } from "../stores/settings.store";
import { useAppInfo, useAppUpdate } from "../hooks/useAppUpdate";
import { useHotkeys, type Options as HotkeyOptions } from "react-hotkeys-hook";
import "../global.css";

// Apply theme immediately (before React renders) to prevent flash
initTheme();

const APP_HOTKEY_OPTIONS: HotkeyOptions = {
  preventDefault: true,
  enableOnFormTags: true,
  enableOnContentEditable: true,
  eventListenerOptions: { capture: true },
};

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

  // Keep the webview from treating refresh as a page reload outside the dashboard.
  useHotkeys("mod+r", () => undefined, APP_HOTKEY_OPTIONS);
  useHotkeys(
    "mod+comma",
    (event) => {
      event.stopPropagation();
      openSettings("appearance");
    },
    APP_HOTKEY_OPTIONS,
    [openSettings],
  );

  return (
    <>
      <Outlet />
      <SettingsModal />
      {/*<TanStackRouterDevtools />*/}
    </>
  );
};

export const Route = createRootRoute({ component: RootLayout });
