import { useState } from "react";
import { Button } from "@heroui/react";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { formatNum } from "../../../lib/format";
import type { DashboardView } from "../../../types/dashboard";

// ── Pill Tab Bar ──────────────────────────────────────────────────────────────

interface PillTabBarProps<T extends string> {
  tabs: readonly T[];
  active: T;
  onChange: (tab: T) => void;
}

function PillTabBar<T extends string>({ tabs, active, onChange }: PillTabBarProps<T>) {
  return (
    <div className="flex p-0.5 rounded-[7px] border border-separator bg-surface-secondary">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className="px-2.5 py-[3px] rounded-[5px] text-xs transition-colors font-sans"
          style={{
            background: active === t ? "var(--surface)" : "transparent",
            color: active === t ? "var(--foreground)" : "var(--muted)",
            fontWeight: active === t ? 500 : 400,
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

// ── Structure Panel ────────────────────────────────────────────────────────────

const STRUCTURE_TABS = ["Columns", "Indexes", "Foreign Keys", "DDL"] as const;
type StructureTabType = (typeof STRUCTURE_TABS)[number];

export function StructurePanel({ activeTable }: { activeTable: string | null }) {
  const [activeTab, setActiveTab] = useState<StructureTabType>("Columns");

  if (!activeTable) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted">Select a table to view its structure</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Sub-tab strip */}
      <div className="flex items-center px-4.5 h-10 border-b border-separator bg-surface shrink-0">
        <PillTabBar tabs={STRUCTURE_TABS} active={activeTab} onChange={setActiveTab} />
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto bg-background">
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-muted">{activeTab} — coming soon</p>
        </div>
      </div>
    </div>
  );
}


const VIEWS = ["Data", "Structure"] as const;

interface TableStatusFooterProps {
  activeTable: string | null;
  activeView: DashboardView;
  onViewChange: (view: DashboardView) => void;
  rowCount: number;
  totalEstimate: number | null;
}

export function TableStatusFooter({
  activeTable,
  activeView,
  onViewChange,
  rowCount,
  totalEstimate,
}: TableStatusFooterProps) {
  if (!activeTable) return null;
  return (
    <div className="flex items-center justify-between gap-4 px-4.5 border-t border-separator bg-surface shrink-0 font-mono text-muted py-2.5 h-14 text-xs">
      <PillTabBar tabs={VIEWS} active={activeView} onChange={onViewChange} />
      {activeView === "Data" && (
        <div className="flex items-center gap-1">
          <Button variant="ghost" className="size-5" isIconOnly>
            <CaretLeftIcon className="size-2.5" />
          </Button>
          <span>1</span>
          <Button variant="ghost" className="size-5" isIconOnly>
            <CaretRightIcon className="size-2.5" />
          </Button>
        </div>
      )}
      {activeView === "Data" && (
        <span>
          <span className="text-foreground">{rowCount}</span>
          {totalEstimate !== null && <span> / {formatNum(totalEstimate)}</span>} rows
        </span>
      )}
    </div>
  );
}


