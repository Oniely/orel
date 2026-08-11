import { useConnectionStore } from "../../stores/connection.store";
import { getDatabaseTabs, useDashboardStore } from "../../stores/dashboard.store";

export function useDashboardContext() {
  const focusedConnectionId = useConnectionStore((state) => state.focusedConnectionId);
  const connection = useConnectionStore((state) =>
    focusedConnectionId ? state.activeConnections[focusedConnectionId] : undefined,
  );
  const connectionId = connection?.config.id ?? null;
  const activeDatabase =
    connection?.activeDatabase ??
    connection?.config.defaultDatabase ??
    connection?.databases[0] ??
    null;
  const databaseKey =
    connectionId && activeDatabase ? `${connectionId}::${activeDatabase}` : "__none__";
  const tabState = useDashboardStore((state) => getDatabaseTabs(state, databaseKey));
  const activeTab = tabState.tabs.find((tab) => tab.id === tabState.activeTabId) ?? null;
  const activeTableName = activeTab?.type === "table" ? activeTab.label : null;

  return {
    connection,
    connectionId,
    activeDatabase,
    databaseKey,
    openTabs: tabState.tabs,
    activeTabId: tabState.activeTabId,
    activeTab,
    activeTableName,
  };
}


