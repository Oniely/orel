import { createFileRoute, redirect } from "@tanstack/react-router";
import { DashboardLayout } from "../components/Dashboard/DashboardLayout";
import { useConnectionStore } from "../stores/connection.store";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: () => {
    const { focusedConnectionId, activeConnections } = useConnectionStore.getState();
    const connection = focusedConnectionId ? activeConnections[focusedConnectionId] : null;
    if (!connection) {
      throw redirect({ to: "/" });
    }
  },
  component: DashboardLayout,
});
