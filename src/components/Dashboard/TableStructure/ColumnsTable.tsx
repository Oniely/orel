import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Button, Dropdown, Label, Switch } from "@heroui/react";
import { LuGripVertical, LuTrash2, LuLink } from "react-icons/lu";
import { KeyIcon } from "../shared/icons";
import {
  CenteredState,
  DELETED_ROW_TINT,
  HintIcon,
  LoadErrorState,
  LoadingState,
  NEW_ROW_TINT,
  NewRowActions,
  RowActions,
  RowIconButton,
  SELECT_CHEVRON_BG,
  SaveBar,
  StatusAlert,
  StructureToolbar,
  UndoButton,
  fieldBoxClass,
  inputClass,
} from "./shared";
import { getTypeColor } from "../../../lib/typeColors";
import { DIALECT_TYPES, FOREIGN_KEYS_READ_ONLY_REASON, TYPE_PARAMS_META } from "../../../lib/dialectTypes";
import { useFetchTableStructure, useApplyStructureChanges } from "../../../hooks/useTables";
import { getErrorMessage } from "../../../lib/error";
import type { StructureColumn } from "../../../types/database";

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
  defaultValue: string | null;
}

export interface ColumnsTableProps {
  connectionId: string | null;
  database: string | null;
  table: string | null;
  /** Opens the Indexes tab with a new index on this (saved) column */
  onAddIndex?: (column: string, unique: boolean) => void;
  /** Opens the Foreign Keys tab with a new foreign key on this (saved) column */
  onAddForeignKey?: (column: string) => void;
}

// ── Key Glyph ────────────────────────────────────────────────────────────────

const PK_COLOR = "oklch(76% 0.13 60)";
const INDEX_COLOR = "oklch(70% 0.15 235)";

type KeyFlags = Pick<StructureColumn, "isPrimary" | "isForeignKey" | "isIndexed">;

// Sizes are classes, not the `size` prop: HeroUI's Button CSS forces nested SVGs
// to 16px with a negative margin, which overrides width/height attributes but not
// Tailwind utilities (they sit in a later cascade layer).
function KeyGlyph({ isPrimary, isForeignKey, isIndexed }: KeyFlags) {
  if (isPrimary) return <KeyIcon className="size-3.5 m-0" style={{ color: PK_COLOR }} />;
  if (isForeignKey)
    return (
      // Sized to look equal, not to have equal boxes: the key drawing fills ~16 of its
      // 24-unit viewBox with a 1.6 stroke, the link ~20 with a 2.0 stroke. At 12px / 10px
      // both render ~8px tall with a ~0.8px stroke. (~23px wide, fits the 26px circle)
      <span className="inline-flex items-center gap-px leading-none" style={{ color: INDEX_COLOR }}>
        <KeyIcon className="size-3 m-0 shrink-0" />
        <LuLink className="size-2.5 m-0 shrink-0" />
      </span>
    );
  if (isIndexed) return <KeyIcon className="size-3.5 m-0" style={{ color: INDEX_COLOR }} />;
  return null;
}

function keyStatus({ isPrimary, isForeignKey, isIndexed }: KeyFlags): string {
  if (isPrimary) return "Primary key";
  if (isForeignKey) return isIndexed ? "Foreign key · indexed" : "Foreign key";
  return isIndexed ? "Indexed" : "Not indexed";
}

// Hidden until the row is hovered or focused, so unkeyed columns stay quiet
const KEY_PLACEHOLDER_CLASS =
  "text-muted opacity-0 transition-opacity duration-150 group-hover/row:opacity-40 group-focus-within/row:opacity-40 [[aria-expanded=true]_&]:opacity-60";

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

// ── Key Menu (saved columns) ─────────────────────────────────────────────────

interface KeyMenuItem {
  id: string;
  label: string;
  /** Set when this item can't be used; listed under the items */
  disabledReason: string | null;
  onAction: () => void;
}

interface KeyMenuProps {
  column: StructureColumn;
  items: KeyMenuItem[];
}

function KeyMenu({ column, items }: KeyMenuProps) {
  const hasKey = column.isPrimary || column.isForeignKey || column.isIndexed;
  const reasons = [...new Set(items.flatMap((i) => (i.disabledReason ? [i.disabledReason] : [])))];
  return (
    <Dropdown>
      <Button
        size="sm"
        variant="ghost"
        isIconOnly
        aria-label={`${keyStatus(column)}. Key options for ${column.name}`}
        className="size-6.5 min-w-0 p-0 rounded-full grid place-items-center transition-colors hover:bg-surface-secondary aria-expanded:bg-surface-secondary focus-visible:ring-1 focus-visible:ring-accent/60"
      >
        {hasKey ? (
          <KeyGlyph {...column} />
        ) : (
          <KeyIcon className={`size-3.5 m-0 ${KEY_PLACEHOLDER_CLASS}`} />
        )}
      </Button>
      <Dropdown.Popover className="w-[220px] p-1">
        <Dropdown.Menu
          disabledKeys={items.filter((i) => i.disabledReason).map((i) => i.id)}
          onAction={(key) => items.find((i) => i.id === key)?.onAction()}
        >
          {items.map((i) => (
            <Dropdown.Item key={i.id} id={i.id} textValue={i.label}>
              <Label>{i.label}</Label>
            </Dropdown.Item>
          ))}
          {reasons.map((reason) => (
            <Dropdown.Item key={reason} id={`reason:${reason}`} textValue={reason} isDisabled>
              <span className="text-[11px] text-muted whitespace-normal">{reason}</span>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

// ── Editable Row ─────────────────────────────────────────────────────────────

interface EditableRowProps {
  values: {
    name: string;
    dataType: string;
    typeParams: string | null;
    isNullable: boolean;
    defaultValue: string | null;
  };
  keyCell: React.ReactNode;
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
  /** Scroll this row into view and focus its name field when it mounts */
  autoFocus?: boolean;
}

function EditableRow({
  values,
  keyCell,
  changed,
  onField,
  dialect,
  tint,
  disabled,
  drag,
  rightAction,
  autoFocus,
}: EditableRowProps) {
  const nameInputRef = useRef<HTMLInputElement>(null);

  // A freshly added column may sit far below the fold on wide tables
  useEffect(() => {
    if (!autoFocus) return;
    const input = nameInputRef.current;
    input?.scrollIntoView({ block: "center", behavior: "smooth" });
    input?.focus({ preventScroll: true });
  }, [autoFocus]);

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
      ? DELETED_ROW_TINT
      : Object.values(changed).some(Boolean)
        ? "color-mix(in oklch, oklch(85% 0.15 95) 6%, transparent)"
        : undefined);

  return (
    <tr
      data-row-idx
      className="group/row"
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

      <td className="px-1.5 py-1.5 text-center">{keyCell}</td>

      <td className="px-2.5 py-1.5">
        <Highlight on={!!changed.name}>
          <div className={fieldBoxClass} style={{ minWidth: 150 }}>
            <input
              ref={nameInputRef}
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
          <Switch
            size="sm"
            aria-label="Nullable"
            isSelected={values.isNullable}
            onChange={(on) => onField("isNullable", on)}
          >
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch>
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


      <td className="px-2.5 py-1.5 whitespace-nowrap" style={{ width: 72 }}>
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
  onAddIndex,
  onAddForeignKey,
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

  // The Key menu switches tabs, which unmounts this table and would discard staged edits
  const keyMenuLockReason = pendingCount > 0 ? "Save or cancel column changes first" : null;

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
      <CenteredState>
        <p className="text-sm text-muted">Select a table to view its columns</p>
      </CenteredState>
    );
  }
  if (isLoading) return <LoadingState />;
  if (error) return <LoadErrorState error={error} fallback="Failed to load columns" />;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface">
      <StructureToolbar
        summary={`${cols.length} columns`}
        pendingCount={pendingCount}
        addLabel="Add column"
        onAdd={addColumn}
      />

      {saveError && (
        <StatusAlert status="danger" banner>
          {saveError}
        </StatusAlert>
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
                  keyCell={
                    isDeleted || !onAddIndex ? (
                      <KeyGlyph isPrimary={col.isPrimary} isForeignKey={col.isForeignKey} isIndexed={col.isIndexed} />
                    ) : (
                      <KeyMenu
                        column={col}
                        items={[
                          {
                            id: "add-index",
                            label: "Add index…",
                            disabledReason: keyMenuLockReason,
                            onAction: () => onAddIndex(col.name, false),
                          },
                          {
                            id: "add-unique",
                            label: "Add unique index…",
                            disabledReason: keyMenuLockReason,
                            onAction: () => onAddIndex(col.name, true),
                          },
                          ...(onAddForeignKey
                            ? [
                                {
                                  id: "add-foreign-key",
                                  label: "Add foreign key…",
                                  disabledReason: keyMenuLockReason ?? FOREIGN_KEYS_READ_ONLY_REASON[dialect] ?? null,
                                  onAction: () => onAddForeignKey(col.name),
                                },
                              ]
                            : []),
                        ]}
                      />
                    )
                  }
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
                    <RowActions>
                      {isDeleted ? (
                        <UndoButton onPress={() => toggleDelete(col.name)} />
                      ) : (
                        <RowIconButton label="Delete column" onPress={() => toggleDelete(col.name)}>
                          <LuTrash2 size={12} />
                        </RowIconButton>
                      )}
                    </RowActions>
                  }
                />
              );
            })}

            {/* Pending adds */}
            {pendingAdds.map((a) => (
              <EditableRow
                key={a.tempId}
                values={a}
                // Pending rows only mount from "Add column", so each one takes focus once
                autoFocus
                keyCell={
                  <HintIcon hint="Save the column first to index it">
                    <KeyIcon size={14} className={KEY_PLACEHOLDER_CLASS} />
                  </HintIcon>
                }
                changed={{}}
                onField={(field, value) =>
                  updatePendingAdd(a.tempId, field, value)
                }
                dialect={dialect}
                tint={NEW_ROW_TINT}
                rightAction={<NewRowActions onDiscard={() => removePendingAdd(a.tempId)} />}
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
      <SaveBar pendingCount={pendingCount} saving={saving} onCancel={cancelAll} onSave={saveAll} />
    </div>
  );
}
