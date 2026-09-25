import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { LuGripVertical, LuPlus, LuTrash2, LuX, LuUndo2, LuLink } from "react-icons/lu";
import { KeyIcon } from "../shared/icons";
import { getTypeColor } from "../../../lib/typeColors";
import { DIALECT_TYPES, TYPE_PARAMS_META } from "../../../lib/dialectTypes";
import { useFetchTableStructure, useApplyStructureChanges } from "../../../hooks/useTables";
import { getErrorMessage } from "../../../lib/error";
import type { StructureColumn } from "../../../types/database";

// Pre-encoded SVG chevron for native select styling (avoids encodeURIComponent on every render)
const SELECT_CHEVRON_BG = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='${encodeURIComponent("rgba(180,180,200,0.7)")}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M6 9l6 6 6-6'/></svg>")`;


interface PendingEdits {
  [originalName: string]: Partial<{
    name: string;
    dataType: string;
    typeParams: string | null;
    isNullable: boolean;
    defaultValue: string | null;
  }>;
}

interface PendingAdd {
  tempId: string;
  name: string;
  dataType: string;
  typeParams: string | null;
  isNullable: boolean;
  isPrimary: boolean;
  isForeignKey: boolean;
  isIndexed: boolean;
  defaultValue: string | null;
}

interface ColumnsTableProps {
  connectionId: string | null;
  database: string | null;
  table: string | null;
}

// ── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="relative shrink-0 rounded-full border border-separator cursor-pointer p-0"
      style={{
        width: 36,
        height: 20,
        background: on
          ? "color-mix(in oklch, oklch(74% 0.13 30) 32%, transparent)"
          : "var(--surface-secondary)",
      }}
    >
      <span
        className="absolute rounded-full transition-[left] duration-[120ms] ease-out"
        style={{
          top: 1.5,
          left: on ? 18 : 2,
          width: 15,
          height: 15,
          background: on ? "oklch(74% 0.13 30)" : "var(--muted)",
        }}
      />
    </button>
  );
}

// ── Highlight wrapper for changed fields ─────────────────────────────────────

function Highlight({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex"
      style={
        on
          ? {
              background: "color-mix(in oklch, oklch(85% 0.15 95) 24%, transparent)",
              borderRadius: 6,
              padding: 2,
              margin: -2,
            }
          : undefined
      }
    >
      {children}
    </span>
  );
}

// ── Key Glyph ────────────────────────────────────────────────────────────────

function KeyGlyph({ isPrimary, isForeignKey, isIndexed }: { isPrimary: boolean; isForeignKey: boolean; isIndexed: boolean }) {
  if (isPrimary)
    return <span className="inline-flex justify-center"><KeyIcon size={13} style={{ color: "oklch(76% 0.13 60)" }} /></span>;
  if (isForeignKey)
    return (
      <span className="inline-flex items-center justify-center gap-0.5">
        <KeyIcon size={12} style={{ color: "oklch(70% 0.15 235)" }} />
        <LuLink size={9} style={{ color: "oklch(70% 0.15 235)", opacity: 0.85 }} />
      </span>
    );
  if (isIndexed)
    return <span className="inline-flex justify-center"><KeyIcon size={12} style={{ color: "oklch(70% 0.15 235)" }} /></span>;
  return null;
}

// ── Editable Row ─────────────────────────────────────────────────────────────

interface EditableRowProps {
  values: {
    name: string;
    dataType: string;
    typeParams: string | null;
    isNullable: boolean;
    isPrimary: boolean;
    isForeignKey: boolean;
    isIndexed: boolean;
    defaultValue: string | null;
  };
  changed: Record<string, boolean>;
  onField: (field: string, value: unknown) => void;
  dialect: string;
  tint?: string;
  disabled?: boolean;
  drag?: {
    isDragging: boolean;
    onGripPointerDown: (e: React.PointerEvent) => void;
  };
  rightAction: React.ReactNode;
}

const fieldBoxClass =
  "h-[30px] rounded-md bg-surface border border-separator flex items-center";
const inputClass =
  "flex-1 bg-transparent border-none outline-none text-foreground text-xs font-mono px-2.5 w-full min-w-0";

function EditableRow({
  values,
  changed,
  onField,
  dialect,
  tint,
  disabled,
  drag,
  rightAction,
}: EditableRowProps) {
  const typeList = DIALECT_TYPES[dialect] ?? DIALECT_TYPES.postgres;
  const paramsMeta = (TYPE_PARAMS_META[dialect] ?? {})[values.dataType];
  // Ensure the current type is always in the list
  const options = useMemo(() => {
    const set = new Set(typeList);
    set.add(values.dataType);
    return [...set].sort();
  }, [typeList, values.dataType]);

  const rowBg =
    tint ||
    (disabled
      ? "color-mix(in oklch, oklch(65% 0.2 25) 12%, transparent)"
      : Object.values(changed).some(Boolean)
        ? "color-mix(in oklch, oklch(85% 0.15 95) 6%, transparent)"
        : undefined);

  return (
    <tr
      data-row-idx
      style={{
        background: rowBg,
        opacity: drag?.isDragging ? 0.4 : disabled ? 0.55 : 1,
        pointerEvents: disabled ? "none" : undefined,
      }}
    >
      {/* Drag handle — only rendered when drag prop is provided */}
      {drag !== undefined && (
        <td className="px-1 py-1.5 text-center">
          {drag && (
            <span
              onPointerDown={drag.onGripPointerDown}
              className="inline-flex text-muted opacity-55 cursor-grab select-none touch-none"
            >
              <LuGripVertical size={13} />
            </span>
          )}
        </td>
      )}

      <td className="px-1.5 py-1.5 text-center">
        <KeyGlyph isPrimary={values.isPrimary} isForeignKey={values.isForeignKey} isIndexed={values.isIndexed} />
      </td>

      <td className="px-2.5 py-1.5">
        <Highlight on={!!changed.name}>
          <div className={fieldBoxClass} style={{ minWidth: 150 }}>
            <input
              value={values.name}
              placeholder="column_name"
              onChange={(e) => onField("name", e.target.value)}
              className={inputClass}
            />
          </div>
        </Highlight>
      </td>


      <td className="px-2.5 py-1.5">
        <Highlight on={!!changed.dataType || !!changed.typeParams}>
          <div className="flex gap-1">
            <div className={fieldBoxClass} style={{ width: 128, flexShrink: 0 }}>
              <select
                value={values.dataType}
                onChange={(e) => onField("dataType", e.target.value)}
                className="appearance-none bg-transparent border-none text-xs font-mono outline-none cursor-pointer pl-2.5 pr-5 h-full w-full min-w-0"
                style={{
                  color: getTypeColor(values.dataType),
                  backgroundImage: SELECT_CHEVRON_BG,
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 5px center",
                }}
              >
                {options.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div
              className={fieldBoxClass}
              style={{
                width: 110,
                flexShrink: 0,
                opacity: paramsMeta ? 1 : 0,
                pointerEvents: paramsMeta ? "auto" : "none",
              }}
            >
              <input
                value={values.typeParams ?? ""}
                placeholder={paramsMeta?.placeholder ?? ""}
                onChange={(e) =>
                  onField("typeParams", e.target.value || null)
                }
                className={`${inputClass} px-2`}
              />
            </div>
          </div>
        </Highlight>
      </td>


      <td className="px-2.5 py-1.5 text-center">
        <Highlight on={!!changed.isNullable}>
          <Toggle
            on={values.isNullable}
            onClick={() => onField("isNullable", !values.isNullable)}
          />
        </Highlight>
      </td>


      <td className="px-2.5 py-1.5">
        <Highlight on={!!changed.defaultValue}>
          <div className={fieldBoxClass} style={{ minWidth: 110 }}>
            <input
              value={values.defaultValue ?? ""}
              placeholder="NULL"
              onChange={(e) =>
                onField("defaultValue", e.target.value || null)
              }
              className={inputClass}
            />
          </div>
        </Highlight>
      </td>


      <td className="px-2.5 py-1.5 text-right whitespace-nowrap" style={{ width: 72 }}>
        {rightAction}
      </td>
    </tr>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function ColumnsTable({
  connectionId,
  database,
  table,
}: ColumnsTableProps) {
  const applyChanges = useApplyStructureChanges();
  const { data, isLoading, error } = useFetchTableStructure(
    connectionId,
    database,
    table,
  );

  const cols = useMemo(() => data?.columns ?? [], [data]);
  const dialect = data?.dialect ?? "postgres";
  const canReorder = dialect === "mysql";

  const [pendingEdits, setPendingEdits] = useState<PendingEdits>({});
  const [pendingDeletes, setPendingDeletes] = useState<string[]>([]);
  const [pendingAdds, setPendingAdds] = useState<PendingAdd[]>([]);
  const [pendingReorder, setPendingReorder] = useState<string[] | null>(null);

  // ── Edit helpers ─────────────────────────────────────────────────────────

  const updateColField = useCallback(
    (name: string, field: string, value: unknown) => {
      const original = cols.find((c) => c.name === name);
      if (!original) return;

      // Params belong to the type: a new type starts without them (the input is
      // hidden for types that take none), and going back restores the original.
      const fields: Record<string, unknown> = { [field]: value };
      if (field === "dataType") {
        fields.typeParams = value === original.dataType ? original.typeParams : null;
      }

      setPendingEdits((prev) => {
        const existing = { ...(prev[name] ?? {}) };
        for (const [key, fieldValue] of Object.entries(fields)) {
          const origVal = (original as unknown as Record<string, unknown>)[key];
          if (fieldValue === origVal) {
            delete existing[key as keyof typeof existing];
          } else {
            (existing as Record<string, unknown>)[key] = fieldValue;
          }
        }

        const next = { ...prev };
        if (Object.keys(existing).length) next[name] = existing;
        else delete next[name];
        return next;
      });
    },
    [cols],
  );

  const toggleDelete = useCallback((name: string) => {
    setPendingDeletes((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }, []);

  const addColumn = useCallback(() => {
    const defaultType =
      dialect === "sqlite"
        ? "text"
        : dialect === "mysql"
          ? "varchar"
          : "text";
    setPendingAdds((prev) => [
      ...prev,
      {
        tempId: `new-${Date.now()}`,
        name: "",
        dataType: defaultType,
        typeParams: null,
        isNullable: true,
        isPrimary: false,
        isForeignKey: false,
        isIndexed: false,
        defaultValue: null,
      },
    ]);
  }, [dialect]);

  const updatePendingAdd = useCallback(
    (tempId: string, field: string, value: unknown) => {
      setPendingAdds((prev) =>
        prev.map((a) =>
          a.tempId === tempId
            ? { ...a, [field]: value, ...(field === "dataType" ? { typeParams: null } : {}) }
            : a,
        ),
      );
    },
    [],
  );

  const removePendingAdd = useCallback((tempId: string) => {
    setPendingAdds((prev) => prev.filter((a) => a.tempId !== tempId));
  }, []);

  // ── Drag-and-drop (pointer events) ───────────────────────────────────────

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ from: -1, over: -1, side: "below" as "above" | "below" });
  const dragCleanupRef = useRef<(() => void) | null>(null);

  const moveColumn = useCallback(
    (from: number, to: number) => {
      const currentOrder = pendingReorder ?? cols.map((c) => c.name);
      const next = [...currentOrder];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      const sameAsOriginal =
        next.join("|") === cols.map((c) => c.name).join("|");
      setPendingReorder(sameAsOriginal ? null : next);
    },
    [cols, pendingReorder],
  );

  // Clean up drag listeners on unmount
  useEffect(() => () => dragCleanupRef.current?.(), []);

  const handleGripDown = useCallback(
    (idx: number, e: React.PointerEvent) => {
      e.preventDefault();
      dragRef.current = { from: idx, over: idx, side: "below" };
      setDragIdx(idx);

      const indicator = indicatorRef.current;
      const container = scrollRef.current;

      const onMove = (ev: PointerEvent) => {
        const tbody = tbodyRef.current;
        if (!tbody || !container) return;
        const containerRect = container.getBoundingClientRect();
        const rows = tbody.querySelectorAll<HTMLElement>("tr[data-row-idx]");
        for (let i = 0; i < rows.length; i++) {
          const rect = rows[i].getBoundingClientRect();
          if (ev.clientY >= rect.top && ev.clientY < rect.bottom) {
            const mid = rect.top + rect.height / 2;
            const side = ev.clientY < mid ? "above" : "below";
            dragRef.current.over = i;
            dragRef.current.side = side;
            if (indicator) {
              if (i !== idx) {
                const lineY = side === "above"
                  ? rect.top - containerRect.top + container.scrollTop
                  : rect.bottom - containerRect.top + container.scrollTop;
                indicator.style.top = `${lineY}px`;
                indicator.style.display = "block";
              } else {
                indicator.style.display = "none";
              }
            }
            break;
          }
        }
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (indicator) indicator.style.display = "none";
        dragCleanupRef.current = null;
      };

      const onUp = () => {
        cleanup();
        const { from, over, side } = dragRef.current;
        setDragIdx(null);
        if (from === over) return;

        let target = over;
        if (side === "below" && over > from) target = over;
        else if (side === "below" && over < from) target = over + 1;
        else if (side === "above" && over > from) target = over - 1;

        if (target !== from) moveColumn(from, target);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      dragCleanupRef.current = cleanup;
    },
    [moveColumn],
  );

  // ── Pending count ────────────────────────────────────────────────────────

  const pendingCount =
    Object.keys(pendingEdits).length +
    pendingDeletes.length +
    pendingAdds.length +
    (pendingReorder ? 1 : 0);

  // ── Save / Cancel ────────────────────────────────────────────────────────

  const { reset: resetApply } = applyChanges;
  const cancelAll = useCallback(() => {
    setPendingEdits({});
    setPendingDeletes([]);
    setPendingAdds([]);
    setPendingReorder(null);
    resetApply();
  }, [resetApply]);

  const saveAll = useCallback(() => {
    if (!connectionId || !table || pendingCount === 0) return;

    const edits = Object.entries(pendingEdits).flatMap(([originalName, diff]) => {
      const orig = cols.find((c) => c.name === originalName);
      // Edits to a column that is also being dropped don't matter
      if (!orig || pendingDeletes.includes(originalName)) return [];
      return [{
        originalName,
        name: (diff.name as string | undefined) ?? orig.name,
        dataType: (diff.dataType as string | undefined) ?? orig.dataType,
        typeParams:
          diff.typeParams !== undefined ? diff.typeParams : orig.typeParams,
        nullable:
          diff.isNullable !== undefined
            ? (diff.isNullable as boolean)
            : orig.isNullable,
        defaultValue:
          diff.defaultValue !== undefined
            ? diff.defaultValue
            : orig.defaultValue,
      }];
    });

    const adds = pendingAdds.map(
      ({ name, dataType, typeParams, isNullable, defaultValue }) => ({
        name,
        dataType,
        typeParams,
        nullable: isNullable,
        defaultValue,
      }),
    );

    applyChanges.mutate(
      {
        connectionId,
        database,
        table,
        changes: { edits, drops: pendingDeletes, adds, reorder: pendingReorder },
      },
      { onSuccess: cancelAll },
    );
  }, [
    connectionId,
    database,
    table,
    pendingCount,
    pendingEdits,
    pendingDeletes,
    pendingAdds,
    pendingReorder,
    cols,
    cancelAll,
    applyChanges,
  ]);

  const saving = applyChanges.isPending;
  const saveError = applyChanges.error ? getErrorMessage(applyChanges.error, "Failed to apply changes") : null;

  // ── Effective column values (original + pending edits) ───────────────────

  const effectiveColumns = useMemo(() => {
    const ordered = pendingReorder
      ? pendingReorder.map((n) => cols.find((c) => c.name === n)!).filter(Boolean)
      : cols;
    return ordered.map((c) => {
      const diff = pendingEdits[c.name];
      if (!diff) return { col: c, eff: c, changed: {} as Record<string, boolean> };
      const eff = { ...c, ...diff } as StructureColumn;
      const changed = Object.fromEntries(
        Object.keys(diff).map((k) => [k, true]),
      );
      return { col: c, eff, changed };
    });
  }, [cols, pendingEdits, pendingReorder]);

  // ── Render ───────────────────────────────────────────────────────────────

  if (!table) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted">Select a table to view its columns</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-danger">{String(error)}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface">
      {/* Toolbar */}
      <div className="h-11 px-4.5 flex items-center gap-2.5 border-b border-separator shrink-0">
        <div className="flex-1" />
        <span className="text-muted text-[11px] font-mono">
          {cols.length} columns
          {pendingCount > 0 && (
            <span className="text-foreground">
              {" "}· {pendingCount} unsaved
            </span>
          )}
        </span>
        <button
          onClick={addColumn}
          className="flex items-center gap-1.5 h-7 px-3 rounded-[7px] bg-surface-secondary text-foreground border border-separator text-xs font-medium cursor-pointer"
        >
          <LuPlus size={11} /> Add column
        </button>
      </div>

      {/* Save error */}
      {saveError && (
        <div className="px-4.5 py-2 bg-danger/10 text-danger text-xs border-b border-separator">
          {saveError}
        </div>
      )}

      {/* Columns table */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-3.5 relative">
        {/* Drag indicator line — positioned via direct DOM mutation, no re-renders */}
        <div
          ref={indicatorRef}
          className="absolute left-0 right-0 h-0.5 bg-accent z-10 pointer-events-none"
          style={{ display: "none" }}
        />
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="sticky top-0 z-[1] bg-surface">
              {([
                canReorder ? { label: "", align: "center" as const, width: 24 } : null,
                { label: "Key", align: "center" as const, width: 40 },
                { label: "Name", align: "left" as const },
                { label: "Type", align: "left" as const },
                { label: "Nullable", align: "center" as const },
                { label: "Default", align: "left" as const },
                { label: "", align: "left" as const },
              ] as const).filter((h): h is NonNullable<typeof h> => h !== null).map((h, i) => (
                  <th
                    key={i}
                    className="py-2.5 px-2.5 text-muted font-medium text-[11px] whitespace-nowrap"
                    style={{ textAlign: h.align, width: "width" in h ? h.width : undefined }}
                  >
                    {h.label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody ref={tbodyRef}>
            {effectiveColumns.map(({ col, eff, changed }, idx) => {
              const isDeleted = pendingDeletes.includes(col.name);

              return (
                <EditableRow
                  key={col.name}
                  values={isDeleted ? col : eff}
                  changed={isDeleted ? {} : changed}
                  onField={(field, value) =>
                    updateColField(col.name, field, value)
                  }
                  dialect={dialect}
                  disabled={isDeleted}
                  drag={canReorder && !isDeleted ? {
                    isDragging: dragIdx === idx,
                    onGripPointerDown: (e) => handleGripDown(idx, e),
                  } : undefined}
                  rightAction={
                    isDeleted ? (
                      <button
                        onClick={() => toggleDelete(col.name)}
                        style={{ pointerEvents: "auto" }}
                        className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-md bg-transparent border border-separator text-foreground text-[11px] cursor-pointer"
                      >
                        <LuUndo2 size={10} /> Undo
                      </button>
                    ) : (
                      <button
                        onClick={() => toggleDelete(col.name)}
                        className="inline-grid place-items-center w-[26px] h-[26px] rounded-md bg-transparent border-none text-muted cursor-pointer"
                        title="Delete column"
                      >
                        <LuTrash2 size={12} />
                      </button>
                    )
                  }
                />
              );
            })}

            {/* Pending adds */}
            {pendingAdds.map((a) => (
              <EditableRow
                key={a.tempId}
                values={a}
                changed={{}}
                onField={(field, value) =>
                  updatePendingAdd(a.tempId, field, value)
                }
                dialect={dialect}
                tint="color-mix(in oklch, oklch(73% 0.18 153) 8%, transparent)"
                rightAction={
                  <>
                    <span className="text-[10.5px] font-semibold mr-2" style={{ color: "oklch(73% 0.18 153)" }}>
                      New
                    </span>
                    <button
                      onClick={() => removePendingAdd(a.tempId)}
                      className="inline-grid place-items-center w-[26px] h-[26px] rounded-md bg-transparent border-none text-muted cursor-pointer"
                      title="Discard"
                    >
                      <LuX size={12} />
                    </button>
                  </>
                }
              />
            ))}

            {cols.length === 0 && pendingAdds.length === 0 && (
              <tr>
                <td
                  colSpan={canReorder ? 7 : 6}
                  className="text-center py-12 text-sm text-muted"
                >
                  No columns
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Save / Cancel bar */}
      <div className="px-4.5 py-3 flex items-center gap-2 shrink-0">
        <div className="flex-1" />
        <button
          onClick={cancelAll}
          disabled={pendingCount === 0}
          className="h-[30px] px-3.5 rounded-[7px] bg-transparent border border-separator text-xs cursor-pointer disabled:cursor-default disabled:opacity-50"
          style={{
            color: pendingCount === 0 ? "var(--muted)" : "var(--foreground)",
          }}
        >
          Cancel
        </button>
        <button
          onClick={saveAll}
          disabled={pendingCount === 0 || saving}
          className="h-[30px] px-4 rounded-[7px] border-none text-xs font-medium cursor-pointer disabled:cursor-default disabled:opacity-60"
          style={{
            background:
              pendingCount === 0
                ? "var(--surface-secondary)"
                : "var(--accent)",
            color:
              pendingCount === 0
                ? "var(--muted)"
                : "var(--accent-foreground)",
          }}
        >
          {saving
            ? "Saving..."
            : `Save changes${pendingCount > 0 ? ` (${pendingCount})` : ""}`}
        </button>
      </div>
    </div>
  );
}
