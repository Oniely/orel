import { createRootRoute, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { SettingsModal } from "../components/SettingsModal";
import { initTheme } from "../stores/theme.store";
import "../global.css";

// Apply theme immediately (before React renders) to prevent flash
initTheme();

const RootLayout = () => {
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const unlisten = listen("open-settings", () => {
      setSettingsOpen(true);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <>
      <Outlet />
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <TanStackRouterDevtools />
    </>
  );
};

export const Route = createRootRoute({ component: RootLayout });
