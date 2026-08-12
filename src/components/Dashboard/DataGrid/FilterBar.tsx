import { Button } from "@heroui/react";
import { CodeSimpleIcon, MagnifyingGlassIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import type { ColumnInfo, FilterOperator, FilterRow } from "../../../types/database";

// ── Filter bar ────────────────────────────────────────────────────────────────

const OP_OPTIONS: FilterOperator[] = [
  "equals",
  "not equals",
  "contains",
  "starts with",
  "in",
  "not in",
  ">",
  "<",
  ">=",
  "<=",
  "is null",
  "is not null",
];

interface FilterBarProps {
  filters: FilterRow[];
  columns: ColumnInfo[];
  onFiltersChange: (filters: FilterRow[]) => void;
  onApply: () => void;
}

export function FilterBar({ filters, columns, onFiltersChange, onApply }: FilterBarProps) {
  const addFilter = () =>
    onFiltersChange([...filters, { col: columns[0]?.name ?? "", op: "equals", val: "", conjunction: "AND" }]);
  const toggleConjunction = (i: number) =>
    onFiltersChange(
      filters.map((f, idx) => (idx === i ? { ...f, conjunction: f.conjunction === "AND" ? "OR" : "AND" } : f)),
    );
  const removeFilter = (i: number) => onFiltersChange(filters.filter((_, idx) => idx !== i));
  const updateFilter = (i: number, key: keyof FilterRow, val: string) =>
    onFiltersChange(filters.map((f, idx) => (idx === i ? { ...f, [key]: val } : f)));

  return (
    <div className="border-b border-separator bg-surface px-4.5 py-2.5">
      {filters.map((f, i) => (
        <div key={i} className={`flex items-center gap-2${i !== filters.length - 1 ? " mb-1.5" : ""}`}>
          {/* Conjunction prefix — CodeIcon for filter #1, AND/OR toggle for the rest */}
          {i === 0 ? (
            <div className="w-9 h-[30px] grid place-items-center rounded-[6px] bg-surface-secondary border border-separator text-muted shrink-0">
              <CodeSimpleIcon size={12} />
            </div>
          ) : (
            <Button
              variant="secondary"
              onClick={() => toggleConjunction(i)}
              className="w-9 h-[30px] grid place-items-center rounded-[6px] text-xs font-semibold font-mono"
            >
              {f.conjunction}
            </Button>
          )}

          {/* Column dropdown */}
          <div className="h-[30px] rounded-[6px] bg-surface-secondary border border-separator flex items-center min-w-[180px]">
            <select
              value={f.col}
              onChange={(e) => updateFilter(i, "col", e.target.value)}
              className="db-select text-(--accent) flex-1"
            >
              {columns.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Operator dropdown */}
          <div className="h-[30px] w-[130px] rounded-[6px] bg-surface-secondary border border-separator flex items-center shrink-0">
            <select
              value={f.op}
              onChange={(e) => updateFilter(i, "op", e.target.value as FilterOperator)}
              className="db-select text-muted flex-1"
            >
              {OP_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>

          {/* Value input */}
          <div className="flex-1 h-[30px] rounded-[6px] bg-surface-secondary border border-separator flex items-center px-3 min-w-0">
            <input
              value={f.val}
              onChange={(e) => updateFilter(i, "val", e.target.value)}
              placeholder="value"
              className="flex-1 bg-transparent border-none outline-none text-foreground text-xs font-mono min-w-0 placeholder:text-muted"
            />
            {f.val && (
              <Button isIconOnly variant="ghost" onClick={() => updateFilter(i, "val", "")} className="size-5">
                <XIcon className="size-2.5" />
              </Button>
            )}
          </div>

          {/* Row controls */}
          <Button
            variant="danger-soft"
            onClick={() => removeFilter(i)}
            className="size-[30px] grid place-items-center shrink-0"
            isIconOnly
          >
            <XIcon className="size-3" />
          </Button>
          <Button variant="outline" onClick={addFilter} className="size-[30px] grid place-items-center" isIconOnly>
            <PlusIcon className="size-3" />
          </Button>

          {/* Apply button — only on last row */}
          {i === filters.length - 1 ? (
            <Button onClick={onApply} className="size-[30px] grid place-items-center" isIconOnly>
              <MagnifyingGlassIcon className="size-3" />
            </Button>
          ) : (
            <div className="w-[30px]" />
          )}
        </div>
      ))}
    </div>
  );
}
