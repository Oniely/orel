import { useState } from "react";
import { DDL } from "./DDL";
import { ColumnsTable } from "./ColumnsTable";
import { ForeignKeysTable, newPendingForeignKey } from "./ForeignKeysTable";
import { IndexesTable, newPendingIndex } from "./IndexesTable";
import { CenteredState } from "./shared";
import { useStructureDraftsStore } from "../../../stores/structure-drafts.store";

const STRUCTURE_TABS = ["Columns", "Indexes", "Foreign Keys", "DDL"] as const;
type StructureTabType = (typeof STRUCTURE_TABS)[number];

interface PillTabBarProps<T extends string> {
  tabs: readonly T[];
  active: T;
  onChange: (tab: T) => void;
}

function PillTabBar<T extends string>({ tabs, active, onChange }: PillTabBarProps<T>) {
  return (
    <div className="flex p-0.5 rounded-[7px] border border-separator bg-surface-secondary">
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className="px-2.5 py-[3px] rounded-[5px] text-xs transition-colors font-sans"
          style={{
            background: active === tab ? "var(--surface)" : "transparent",
            color: active === tab ? "var(--foreground)" : "var(--muted)",
            fontWeight: active === tab ? 500 : 400,
          }}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

interface StructurePanelProps {
  connectionId: string | null;
  database: string | null;
  activeTable: string | null;
  /** The active table's dashboard scope (null without one); staged changes are kept under it */
  scopeKey: string | null;
}

export function StructurePanel({ connectionId, database, activeTable, scopeKey }: StructurePanelProps) {
  const [activeTab, setActiveTab] = useState<StructureTabType>("Columns");

  if (!activeTable || !scopeKey) {
    return (
      <CenteredState>
        <p className="text-sm text-muted">Select a table to view its structure</p>
      </CenteredState>
    );
  }

  const { stageAdd } = useStructureDraftsStore.getState();

  // Tabs are keyed by scopeKey so local UI state (drag, focus, save status) resets per table
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center px-4.5 h-10 border-b border-separator bg-surface shrink-0">
        <PillTabBar tabs={STRUCTURE_TABS} active={activeTab} onChange={setActiveTab} />
      </div>

      <div className="flex-1 overflow-auto bg-background">
        {activeTab === "Columns" ? (
          <ColumnsTable
            key={scopeKey}
            connectionId={connectionId}
            database={database}
            table={activeTable}
            scopeKey={scopeKey}
            // The Key menu stages a pre-filled row on the target tab, then opens it
            onAddIndex={(column, unique) => {
              stageAdd("indexes", scopeKey, newPendingIndex(activeTable, column, unique));
              setActiveTab("Indexes");
            }}
            onAddForeignKey={(column) => {
              stageAdd("foreignKeys", scopeKey, newPendingForeignKey(activeTable, column));
              setActiveTab("Foreign Keys");
            }}
          />
        ) : activeTab === "Indexes" ? (
          <IndexesTable
            key={scopeKey}
            connectionId={connectionId}
            database={database}
            table={activeTable}
            scopeKey={scopeKey}
          />
        ) : activeTab === "Foreign Keys" ? (
          <ForeignKeysTable
            key={scopeKey}
            connectionId={connectionId}
            database={database}
            table={activeTable}
            scopeKey={scopeKey}
          />
        ) : (
          <DDL connectionId={connectionId} database={database} table={activeTable} />
        )}
      </div>
    </div>
  );
}
