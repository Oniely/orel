import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useListDatabases } from "../useConnections";
import { useDashboardCommands } from "./useDashboardCommands";
import { useDashboardContext } from "./useDashboardContext";

export function useDashboardEventListeners() {
  const { connectionId, connection } = useDashboardContext();
  const commands = useDashboardCommands();

  useListDatabases(connectionId, connection?.status === "connected");

  useEffect(() => {
    const unlisten = listen("refresh", commands.refresh);
    return () => {
      void unlisten.then((stopListening) => stopListening());
    };
  }, [commands.refresh]);
}
