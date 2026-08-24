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

const VIEWS = ["Data", "Structure"] as const;

interface TableStatusFooterProps {
  activeTable: string | null;
  activeView: DashboardView;
  onViewChange: (view: DashboardView) => void;
  rowCount: number;
  totalResults: number;
  totalPages: number;
  page: number;
  limit: number;
  onPageChange: (page: number) => void;
}

export function TableStatusFooter({
  activeTable,
  activeView,
  onViewChange,
  rowCount,
  totalResults,
  totalPages,
  page,
  limit,
  onPageChange,
}: TableStatusFooterProps) {
  if (!activeTable) return null;
  return (
    <div className="flex items-center justify-between gap-4 px-4.5 border-t border-separator bg-surface shrink-0 font-mono text-muted py-2.5 h-14 text-xs">
      <PillTabBar tabs={VIEWS} active={activeView} onChange={onViewChange} />
      {activeView === "Data" && (
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            className="size-5"
            isIconOnly
            isDisabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <CaretLeftIcon className="size-2.5" />
          </Button>
          <span className="tabular-nums">
            <span className="text-foreground">{page}</span>
            {totalPages > 1 && <span> / {formatNum(totalPages)}</span>}
          </span>
          <Button
            variant="ghost"
            className="size-5"
            isIconOnly
            isDisabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            <CaretRightIcon className="size-2.5" />
          </Button>
        </div>
      )}
      {activeView === "Data" && (
        <span className="tabular-nums">
          {totalResults > 0 ? (
            <>
              <span className="text-foreground">
                <span className="text-[11px]">{formatNum((page - 1) * limit + 1)}</span>
                &ndash;
                {formatNum((page - 1) * limit + rowCount)}
              </span>
              {" / "}
              {formatNum(totalResults)}
            </>
          ) : (
            <span className="text-foreground">{formatNum(rowCount)}</span>
          )}
          {" rows"}
        </span>
      )}
    </div>
  );
}
