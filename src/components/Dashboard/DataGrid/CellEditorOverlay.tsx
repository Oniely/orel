import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FkCell, FkOption } from "../../../types/database";
import { useFetchFkOptions } from "../../../hooks/useTables";

// ── Single floating cell editor (only 1 instance in the DOM) ─────────────────

interface CellEditorOverlayProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  cellAttr: string;
  initialValue: string;
  dataType?: string;
  isNullable?: boolean;
  /** ENUM columns pick from these values instead of free text */
  enumValues?: string[];
  /** Single-column foreign keys pick from the referenced keys, or take typed text */
  fkCell?: FkCell;
  /** Returns an error message to keep the editor open (e.g. invalid JSON) */
  onCommit: (value: string) => string | null;
  onCancel: () => void;
  onAdvance: (direction: 1 | -1) => void;
  /** Continue editing the current text in the expanded value editor */
  onExpand: (value: string) => void;
}

export function CellEditorOverlay({
  containerRef,
  cellAttr,
  initialValue,
  dataType,
  isNullable,
  enumValues,
  fkCell,
  onCommit,
  onCancel,
  onAdvance,
  onExpand,
}: CellEditorOverlayProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const committedRef = useRef(false);
  const [localValue, setLocalValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  // Measure target cell position relative to the scroll container
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const td = container.querySelector(`[data-cell="${cellAttr}"]`) as HTMLElement | null;
    if (!td) return;

    const cRect = container.getBoundingClientRect();
    const tRect = td.getBoundingClientRect();
    setPos({
      top: tRect.top - cRect.top + container.scrollTop,
      left: tRect.left - cRect.left + container.scrollLeft,
      width: tRect.width,
      height: tRect.height,
    });
  }, [containerRef, cellAttr]);

  // Focus + cursor at end (text inputs only — selects don't support text ranges)
  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      return;
    }
    selectRef.current?.focus();
  }, [pos]);

  if (!pos) return null;

  /** Returns false when the value was rejected and the editor stays open */
  const doCommit = (value: string = localValue) => {
    if (committedRef.current) return true;
    const rejected = onCommit(value);
    setError(rejected);
    if (rejected) return false;
    committedRef.current = true;
    return true;
  };

  const expand = () => {
    committedRef.current = true;
    onExpand(localValue);
  };

  const isBoolean = dataType?.toLowerCase() === "boolean";
  // A nullable column's "" option already means NULL, so an empty enum value can't be offered separately
  const options = isBoolean ? ["true", "false"] : (enumValues ?? []).filter((v) => !(isNullable && v === ""));
  const isSelect = isBoolean || options.length > 0;

  return (
    <div
      className="absolute z-[3] flex items-center px-[14px]"
      style={{
        top: pos.top,
        left: pos.left,
        width: pos.width,
        height: pos.height,
        background: `color-mix(in oklch, var(${error ? "--danger" : "--warning"}) 10%, var(--background))`,
        boxShadow: `inset 0 0 0 1px var(${error ? "--danger" : "--warning"})`,
      }}
      title={error ?? undefined}
    >
      {isSelect ? (
        <select
          ref={selectRef}
          className="w-full h-full bg-transparent border-none outline-none font-mono text-xs cursor-pointer"
          style={{ color: "var(--foreground)" }}
          value={isBoolean ? localValue.toLowerCase() : localValue}
          onChange={(e) => {
            setLocalValue(e.target.value);
            doCommit(e.target.value);
          }}
          onBlur={() => doCommit()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              committedRef.current = true;
              onCancel();
            } else if (e.key === "Tab") {
              e.preventDefault();
              doCommit();
              onAdvance(e.shiftKey ? -1 : 1);
            }
          }}
        >
          {isNullable && <option value="">NULL</option>}
          {options.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      ) : fkCell ? (
        <FkInput
          fkCell={fkCell}
          inputRef={inputRef}
          initialValue={initialValue}
          value={localValue}
          isNullable={!!isNullable}
          onChange={setLocalValue}
          onCommit={doCommit}
          onCancel={() => {
            committedRef.current = true;
            onCancel();
          }}
          onAdvance={onAdvance}
        />
      ) : (
        <input
          ref={inputRef}
          className="w-full bg-transparent border-none outline-none font-mono text-xs"
          style={{ color: "var(--foreground)" }}
          value={localValue}
          aria-invalid={!!error}
          onChange={(e) => {
            setLocalValue(e.target.value);
            setError(null);
          }}
          // Invalid text isn't thrown away on blur — it moves to the expanded editor instead
          onBlur={() => {
            if (!doCommit()) expand();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              doCommit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              committedRef.current = true;
              onCancel();
            } else if (e.key === "Tab") {
              e.preventDefault();
              if (doCommit()) onAdvance(e.shiftKey ? -1 : 1);
            }
          }}
        />
      )}
      {/* Dot indicator */}
      <div
        className="absolute bottom-0 right-0 w-2 h-2 rounded-full translate-x-1/2 translate-y-1/2"
        style={{ background: error ? "var(--danger)" : "var(--warning)" }}
      />
    </div>
  );
}

interface FkInputProps {
  fkCell: FkCell;
  inputRef: React.RefObject<HTMLInputElement | null>;
  initialValue: string;
  value: string;
  isNullable: boolean;
  onChange: (value: string) => void;
  onCommit: (value?: string) => boolean;
  onCancel: () => void;
  onAdvance: (direction: 1 | -1) => void;
}

/** Text input with a searchable list of referenced keys; null stands for the NULL option */
function FkInput({ fkCell, inputRef, initialValue, value, isNullable, onChange, onCommit, onCancel, onAdvance }: FkInputProps) {
  const listId = useId();
  const [active, setActive] = useState(-1);
  const [search, setSearch] = useState("");
  useEffect(() => {
    // The untouched cell value lists everything rather than just itself
    const id = setTimeout(() => setSearch(value === initialValue ? "" : value), 250);
    return () => clearTimeout(id);
  }, [value, initialValue]);
  const { data = [], isFetching, isError } = useFetchFkOptions(fkCell, search);
  const options: (FkOption | null)[] = isNullable ? [null, ...data] : data;
  const commitOption = (option: FkOption | null) => onCommit(option?.value ?? "");
  const commitCurrent = () => (active >= 0 && options[active] !== undefined ? commitOption(options[active]) : onCommit());

  return (
    <>
      <input
        ref={inputRef}
        className="w-full bg-transparent border-none outline-none font-mono text-xs"
        style={{ color: "var(--foreground)" }}
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(-1);
        }}
        onBlur={() => onCommit()}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const step = e.key === "ArrowDown" ? 1 : -1;
            setActive((i) => Math.max(-1, Math.min(options.length - 1, i + step)));
          } else if (e.key === "Enter") {
            e.preventDefault();
            commitCurrent();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          } else if (e.key === "Tab") {
            e.preventDefault();
            if (commitCurrent()) onAdvance(e.shiftKey ? -1 : 1);
          }
        }}
      />
      <div
        id={listId}
        role="listbox"
        className="absolute left-0 top-full mt-1 min-w-full w-max max-w-80 max-h-60 overflow-auto rounded-lg border border-separator bg-surface shadow-xl py-1"
        style={{ color: "var(--foreground)" }}
      >
        {options.map((option, i) => (
          <div
            key={option?.value ?? ""}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            className={`flex items-baseline gap-2.5 px-3 py-[5px] font-mono text-xs cursor-pointer hover:bg-surface-secondary ${i === active ? "bg-surface-secondary" : ""}`}
            // Keep focus in the input so its blur doesn't commit the typed text first
            onMouseDown={(e) => {
              e.preventDefault();
              commitOption(option);
            }}
          >
            {option ? option.value : <span className="text-muted">NULL</span>}
            {option?.label && <span className="truncate font-sans text-muted">{option.label}</span>}
          </div>
        ))}
        {data.length === 0 && (
          <div className="px-3 py-[5px] text-xs text-muted">
            {isError ? "Couldn't load values" : isFetching ? "Loading…" : "No matches"}
          </div>
        )}
      </div>
    </>
  );
}


