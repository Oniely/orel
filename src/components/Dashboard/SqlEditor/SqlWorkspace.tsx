import { SqlEditor, type SqlEditorCommands } from "./SqlEditor";
import { useDashboardStore } from "../../../stores/dashboard.store";
import { useDashboardCommands } from "../../../hooks/dashboard/useDashboardCommands";
import { useDashboardContext } from "../../../hooks/dashboard/useDashboardContext";

export function SqlWorkspace() {
  const { connectionId, databaseKey, openTabs, activeTab } = useDashboardContext();
  const commands = useDashboardCommands();
  const updateSql = useDashboardStore((state) => state.updateSql);
  const updateEditorState = useDashboardStore((state) => state.updateEditorState);

  if (activeTab?.type !== "query") return null;

  const editorCommands: SqlEditorCommands = {
    closeTab: () => commands.closeTab(activeTab.id),
    newQuery: commands.openQuery,
    nextTab: () => commands.cycleTab(1),
    prevTab: () => commands.cycleTab(-1),
    switchTab: (index) => {
      const tab = openTabs[index];
      if (tab) commands.activateTab(tab.id);
    },
  };

  return (
    <SqlEditor
      key={activeTab.id}
      editorId={activeTab.id}
      connectionId={connectionId ?? ""}
      sql={activeTab.sql}
      state={activeTab.editorState}
      onSqlChange={(sql) => updateSql(databaseKey, activeTab.id, sql)}
      onStateChange={(state) => updateEditorState(databaseKey, activeTab.id, state)}
      onDataChanged={commands.refresh}
      commands={editorCommands}
    />
  );
}
