import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "../components/Dashboard/DashboardLayout";

export const Route = createFileRoute("/dashboard")({
  component: DashboardLayout,
});
