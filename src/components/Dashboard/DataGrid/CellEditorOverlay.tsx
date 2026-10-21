import { useEffect, useLayoutEffect, useRef, useState } from "react";

// ── Single floating cell editor (only 1 instance in the DOM) ─────────────────

interface CellEditorOverlayProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  cellAttr: string;
  initialValue: string;
  dataType?: string;
  isNullable?: boolean;
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
      {isBoolean ? (
        <select
          ref={selectRef}
          className="w-full h-full bg-transparent border-none outline-none font-mono text-xs cursor-pointer"
          style={{ color: "var(--foreground)" }}
          value={localValue === "" ? "" : localValue.toLowerCase()}
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
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
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
            if (e.key === "Enter" && e.shiftKey) {
              e.preventDefault();
              expand();
            } else if (e.key === "Enter") {
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


