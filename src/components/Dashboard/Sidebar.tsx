import { useState } from "react";
import type { TableInfo } from "../../types/database";
import { INNER_W, SIDEBAR_PAD, SIDEBAR_WIDTH } from "./constants";
import { ViewIcon } from "./icons";
import { MeteorIcon, PicnicTableIcon, PlusIcon } from "@phosphor-icons/react";
import { Button, SearchField } from "@heroui/react";
import { formatNum } from "../../lib/format";

interface SidebarProps {
  tables: TableInfo[];
  isLoading: boolean;
  error: string | null;
  activeTable: string | null;
  onTableClick: (name: string) => void;
  onNewQuery: () => void;
  sidebarOpen: boolean;
  onDisconnect: () => void;
}

export function Sidebar({
  tables,
  isLoading,
  error,
  activeTable,
  onTableClick,
  onNewQuery,
  sidebarOpen,
  onDisconnect,
}: SidebarProps) {
  const [search, setSearch] = useState("");

  const visibleTables = error ? [] : tables;
  const filtered = visibleTables.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()));
  const tableList = filtered.filter((t) => t.tableType === "table");
  const viewList = filtered.filter((t) => t.tableType === "view");

  return (
    <div
      className="flex flex-col shrink-0 border-r border-separator bg-surface text-surface-foreground"
      style={{ width: sidebarOpen ? SIDEBAR_WIDTH : "auto", display: sidebarOpen ? "flex" : "none" }}
    >
      {/* Search */}
      <div style={{ padding: `12px ${SIDEBAR_PAD}px 8px` }}>
        <SearchField
          aria-label="Search tables"
          value={search}
          onChange={setSearch}
          style={{ width: INNER_W }}
          variant="secondary"
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Search…" className="text-xs font-medium" />
            <SearchField.ClearButton className="-ml-2" />
          </SearchField.Group>
        </SearchField>
      </div>

      {/* Tables section header */}
      <div className="flex items-center justify-between px-2.5 py-1">
        <span className="px-2.5 py-1 text-muted text-xs font-medium">Tables</span>
        <span className="px-2.5 py-1 text-muted text-xs font-mono">{isLoading ? "…" : tableList.length}</span>
      </div>

      {/* Table list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 scrollbar-hide">
        {isLoading && <div className="px-3 py-4 text-center text-xs text-muted">Loading…</div>}

        {!isLoading && error && <div className="px-3 py-4 text-center text-xs text-danger">{error}</div>}

        {!isLoading && !error && tableList.length === 0 && !search && (
          <div className="px-3 py-4 text-center text-xs text-muted">No tables</div>
        )}

        {tableList.map((t) => {
          const isActive = activeTable === t.name;
          return (
            <Button
              key={t.name}
              onClick={() => onTableClick(t.name)}
              className="flex items-center text-left gap-2.5 w-full h-[34px] px-2.5 mb-0.5"
              style={{
                background: isActive ? "color-mix(in oklch, var(--accent) 18%, transparent)" : "transparent",
              }}
            >
              <PicnicTableIcon
                size={14}
                style={{
                  color: isActive ? "var(--accent)" : "var(--muted)",
                  opacity: isActive ? 1 : 0.4,
                }}
              />
              <span
                className="flex-1 font-mono text-[12px] truncate"
                style={{ color: isActive ? "var(--accent)" : "var(--foreground)" }}
              >
                {t.name}
              </span>
              {t.rowEstimate !== null && (
                <span className="text-[11px] text-muted font-mono shrink-0">{formatNum(t.rowEstimate)}</span>
              )}
            </Button>
          );
        })}

        {/* Views */}
        {viewList.length > 0 && (
          <>
            <div className="px-2.5 py-1 text-muted text-[11px] font-medium mt-3">Views</div>
            {viewList.map((t) => (
              <Button
                key={t.name}
                onClick={() => onTableClick(t.name)}
                className="flex items-center gap-2.5 w-full h-[34px] px-2.5 text-left mb-[1px]"
              >
                <ViewIcon size={11} className="text-muted opacity-70 shrink-0" />
                <span className="flex-1 font-mono text-[12px] truncate text-foreground">{t.name}</span>
              </Button>
            ))}
          </>
        )}
      </div>

      {/* Bottom: New query button */}
      <div
        className="border-t border-separator flex items-center flex-row-reverse gap-2 py-2.5 h-14"
        style={{ padding: `10px ${SIDEBAR_PAD}px` }}
      >
        <Button variant="tertiary" onClick={onNewQuery} className="text-xs flex-1">
          <PlusIcon className="size-3" weight="bold" />
          New query
        </Button>
        <Button variant="danger-soft" onClick={onDisconnect}>
          <MeteorIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}
