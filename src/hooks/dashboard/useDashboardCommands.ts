import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@heroui/react";
import { useDisconnect, useSwitchDatabase } from "../useConnections";
import { databaseQueryKeys } from "../useTables";
import type { NavigationIntent } from "../../types/dashboard";
import { getActiveEditorIds, useDashboardStoreApi } from "../../stores/dashboard.store";
import { useDashboardContext } from "./useDashboardContext";

export function useDashboardCommands() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const store = useDashboardStoreApi();
  const { connectionId, activeDatabase, databaseKey, openTabs, activeTabId } = useDashboardContext();
  const switchDatabase = useSwitchDatabase();
  const disconnectMutation = useDisconnect();

  // Returns true and shows a warning if the active query tab is still running a SQL operation.
  const blockPendingEditorNavigation = useCallback(() => {
    const state = store.getState();
    const current = state.tabState[databaseKey];
    const activeTab = current?.tabs.find((tab) => tab.id === current.activeTabId);
    if (activeTab?.type !== "query" || !activeTab.editorState.operationPending) return false;
    toast.warning("Wait for the current editor operation to finish before leaving this query tab");
    return true;
  }, [databaseKey, store]);

  // Returns the IDs of query tabs that still have an open or failed transaction.
  const activeEditorIdsForKeys = useCallback((keys: string[]) => getActiveEditorIds(store.getState(), keys), [store]);

  // Refetches tables, rows, DDL, and databases for the current connection.
  const refresh = useCallback(() => {
    if (connectionId && activeDatabase) {
      void queryClient.refetchQueries({
        queryKey: databaseQueryKeys.rowsForDatabase(connectionId, activeDatabase),
      });
      void queryClient.refetchQueries({
        queryKey: databaseQueryKeys.tables(connectionId, activeDatabase),
      });
      void queryClient.refetchQueries({
        queryKey: databaseQueryKeys.tableDdlForDatabase(connectionId, activeDatabase),
      });
    }
    void queryClient.refetchQueries({
      queryKey: databaseQueryKeys.databases(connectionId),
    });
  }, [queryClient, connectionId, activeDatabase]);

  // Carries out a navigation action (close tab, switch database, disconnect) once all guards have cleared.
  const performIntent = useCallback(
    (intent: NavigationIntent) => {
      if (intent.kind === "close-tab") {
        store.getState().closeTab(intent.databaseKey, intent.tabId);
        return;
      }
      if (intent.kind === "switch-database") {
        store.getState().setSelectedRowIndex(null);
        store.getState().setShowInspector(false);
        switchDatabase.mutate(
          { connectionId: intent.connectionId, database: intent.database },
          {
            onSuccess: () => {
              void queryClient.invalidateQueries({
                queryKey: databaseQueryKeys.rowsForDatabase(intent.connectionId, intent.database),
              });
              void queryClient.invalidateQueries({
                queryKey: databaseQueryKeys.tables(intent.connectionId, intent.database),
              });
              void queryClient.invalidateQueries({
                queryKey: databaseQueryKeys.tableDdlForDatabase(intent.connectionId, intent.database),
              });
            },
          },
        );
        return;
      }
      void disconnectMutation
        .mutateAsync(intent.connectionId)
        .then(() => navigate({ to: "/" }))
        .catch(() => undefined);
    },
    [disconnectMutation, navigate, queryClient, store, switchDatabase],
  );

  // Opens a table tab, or switches to it if already open. Does nothing if SQL is still running.
  const openTable = useCallback(
    (name: string) => {
      if (blockPendingEditorNavigation()) return;
      store.getState().openTable(databaseKey, name);
    },
    [blockPendingEditorNavigation, databaseKey, store],
  );

  // Opens a new query tab. Does nothing if SQL is still running.
  const openQuery = useCallback(() => {
    if (blockPendingEditorNavigation()) return;
    store.getState().openQuery(databaseKey);
  }, [blockPendingEditorNavigation, databaseKey, store]);

  // Switches to a tab by ID. Does nothing if the current tab is still running SQL.
  const activateTab = useCallback(
    (id: string) => {
      const activeId = store.getState().tabState[databaseKey]?.activeTabId;
      if (id !== activeId && blockPendingEditorNavigation()) return;
      store.getState().activateTab(databaseKey, id);
    },
    [blockPendingEditorNavigation, databaseKey, store],
  );

  // Closes a tab. If the tab has an open transaction, asks you to commit or roll back first.
  const closeTab = useCallback(
    (id: string) => {
      const state = store.getState();
      const tabState = state.tabState[databaseKey];
      if (id === tabState?.activeTabId && blockPendingEditorNavigation()) return;
      const tab = tabState?.tabs.find((candidate) => candidate.id === id);
      if (tab?.type === "query" && tab.editorState.transactionState !== "inactive") {
        state.setTransactionGuard({
          editorIds: [id],
          title: "Close query with an active transaction?",
          description: "Commit or roll back the transaction before closing this query tab.",
          intent: { kind: "close-tab", databaseKey, tabId: id },
        });
        return;
      }
      state.closeTab(databaseKey, id);
    },
    [blockPendingEditorNavigation, databaseKey, store],
  );

  // Moves focus to the next or previous tab, wrapping around. Use 1 for next, -1 for previous.
  const cycleTab = useCallback(
    (direction: 1 | -1) => {
      if (openTabs.length < 2) return;
      const index = openTabs.findIndex((tab) => tab.id === activeTabId);
      store.getState().activateTab(databaseKey, openTabs[(index + direction + openTabs.length) % openTabs.length].id);
    },
    [activeTabId, databaseKey, openTabs, store],
  );

  // Switches the active database. If any query tabs have open transactions, asks you to resolve them first.
  const selectDatabase = useCallback(
    (database: string) => {
      if (!connectionId || !database || database === activeDatabase) return;
      if (blockPendingEditorNavigation()) return;
      const editorIds = activeEditorIdsForKeys([databaseKey]);
      const intent: NavigationIntent = {
        kind: "switch-database",
        connectionId,
        database,
      };
      if (editorIds.length > 0) {
        store.getState().setTransactionGuard({
          editorIds,
          title: "Resolve transactions before switching database",
          description:
            "Each active query transaction must be committed or rolled back before Orel can replace the database pool.",
          intent,
        });
        return;
      }
      performIntent(intent);
    },
    [
      activeDatabase,
      activeEditorIdsForKeys,
      blockPendingEditorNavigation,
      connectionId,
      databaseKey,
      performIntent,
      store,
    ],
  );

  // Disconnects from the current connection. If any query tabs have open transactions, asks you to resolve them first.
  const disconnect = useCallback(() => {
    if (!connectionId || blockPendingEditorNavigation()) return;
    const connectionKeys = Object.keys(store.getState().tabState).filter((key) => key.startsWith(`${connectionId}::`));
    const editorIds = activeEditorIdsForKeys(connectionKeys);
    const intent: NavigationIntent = { kind: "disconnect", connectionId };
    if (editorIds.length > 0) {
      store.getState().setTransactionGuard({
        editorIds,
        title: "Resolve transactions before disconnecting",
        description: "Choose whether to commit or roll back each active query transaction before disconnecting.",
        intent,
      });
      return;
    }
    performIntent(intent);
  }, [activeEditorIdsForKeys, blockPendingEditorNavigation, connectionId, performIntent, store]);

  return {
    activateTab,
    cycleTab,
    closeTab,
    openQuery,
    openTable,
    performIntent,
    refresh,
    disconnect,
    selectDatabase,
  };
}
