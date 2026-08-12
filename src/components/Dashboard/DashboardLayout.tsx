import { DashboardWorkspace } from "./DashboardWorkspace";
import { DashboardStoreProvider, useDashboardStore } from "../../stores/dashboard.store";
import { Header } from "./Header/Header";
import { RowInspector } from "./RowInspector/RowInspector";
import { Sidebar } from "./Sidebar/Sidebar";
import { TransactionGuardDialog } from "./Transactions/TransactionGuardDialog";
import { useDashboardContext } from "../../hooks/dashboard/useDashboardContext";
import { useDashboardHotkeys } from "../../hooks/dashboard/useDashboardHotkeys";
import { useDashboardEventListeners } from "../../hooks/dashboard/useDashboardEventListeners";

function DashboardShell() {
  const { connection } = useDashboardContext();
  const showInspector = useDashboardStore((state) => state.showInspector);

  useDashboardHotkeys();
  useDashboardEventListeners();

  if (!connection) return null;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      <Header />
      <div className="flex-1 flex min-h-0">
        <Sidebar />
        <DashboardWorkspace />
        {showInspector && <RowInspector />}
      </div>
      {/* Shows when you close a Query Tab with active transaction */}
      <TransactionGuardDialog />
    </div>
  );
}

export function DashboardLayout() {
  return (
    <DashboardStoreProvider>
      <DashboardShell />
    </DashboardStoreProvider>
  );
}
