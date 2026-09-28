import { useState } from "react";
import { DDL } from "./DDL";
import { ColumnsTable } from "./ColumnsTable";
import { IndexesTable, type IndexSeed } from "./IndexesTable";
import { CenteredState } from "./shared";

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
}

export function StructurePanel({ connectionId, database, activeTable }: StructurePanelProps) {
  const [activeTab, setActiveTab] = useState<StructureTabType>("Columns");
  // Set by the Columns tab's Key menu; consumed when the Indexes tab mounts
  const [indexSeed, setIndexSeed] = useState<(IndexSeed & { scopeKey: string }) | null>(null);

  const changeTab = (tab: StructureTabType) => {
    setIndexSeed(null);
    setActiveTab(tab);
  };

  if (!activeTable) {
    return (
      <CenteredState>
        <p className="text-sm text-muted">Select a table to view its structure</p>
      </CenteredState>
    );
  }

  // Keyed so staged changes never carry over to a same-named table in another database or connection
  const scopeKey = `${connectionId}::${database}::${activeTable}`;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center px-4.5 h-10 border-b border-separator bg-surface shrink-0">
        <PillTabBar tabs={STRUCTURE_TABS} active={activeTab} onChange={changeTab} />
      </div>

      <div className="flex-1 overflow-auto bg-background">
        {activeTab === "Columns" ? (
          <ColumnsTable
            key={scopeKey}
            connectionId={connectionId}
            database={database}
            table={activeTable}
            onAddIndex={(column, unique) => {
              setIndexSeed({ scopeKey, column, unique });
              setActiveTab("Indexes");
            }}
          />
        ) : activeTab === "Indexes" ? (
          <IndexesTable
            key={scopeKey}
            connectionId={connectionId}
            database={database}
            table={activeTable}
            seed={indexSeed?.scopeKey === scopeKey ? indexSeed : null}
          />
        ) : activeTab === "DDL" ? (
          <DDL connectionId={connectionId} database={database} table={activeTable} />
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted">{activeTab} - coming soon</p>
          </div>
        )}
      </div>
    </div>
  );
}
