import { useCallback, useEffect, useMemo } from "react";
import { Chip } from "@heroui/react";
import { LuLock, LuTrash2 } from "react-icons/lu";
import {
  useApplyForeignKeyChanges,
  useFetchTableForeignKeys,
  useFetchTableStructure,
  useListTables,
} from "../../../hooks/useTables";
import { FOREIGN_KEYS_READ_ONLY_REASON, REFERENTIAL_ACTIONS } from "../../../lib/dialectTypes";
import { getErrorMessage } from "../../../lib/error";
import { useStructureDraftField, useStructureDraftsStore } from "../../../stores/structure-drafts.store";
import type { ForeignKey, ReferentialAction } from "../../../types/database";
import type { PendingForeignKey } from "../../../types/structure-drafts";
import {
  DELETED_ROW_TINT,
  FieldSelect,
  HintIcon,
  LoadErrorState,
  LoadingState,
  MAX_IDENTIFIER_LENGTH,
  NEW_ROW_TINT,
  NewRowActions,
  RowActions,
  RowIconButton,
  SaveBar,
  SaveStatusBanner,
  StructureToolbar,
  UndoButton,
  fieldBoxClass,
  inputClass,
} from "./shared";

interface ForeignKeysTableProps {
  connectionId: string | null;
  database: string | null;
  table: string;
  /** The table's dashboard scope; staged changes are kept under it */
  scopeKey: string;
}

// Table-prefixed because MySQL constraint names are unique per database, not per table
function autoForeignKeyName(table: string, column: string): string {
  const parts = column ? [table, column, "fkey"] : [table, "fkey"];
  return parts.join("_").slice(0, MAX_IDENTIFIER_LENGTH);
}

function withAutoName(table: string, fk: PendingForeignKey): PendingForeignKey {
  if (fk.nameTouched) return fk;
  return { ...fk, name: autoForeignKeyName(table, fk.column) };
}

/** A new staged foreign key; the Columns tab's Key menu pre-fills its column */
export function newPendingForeignKey(table: string, column = ""): PendingForeignKey {
  return withAutoName(table, {
    tempId: crypto.randomUUID(),
    name: "",
    nameTouched: false,
    column,
    referencedTable: "",
    referencedColumn: "",
    onUpdate: "NO ACTION",
    onDelete: "NO ACTION",
  });
}

// Fixed column widths (table-layout: fixed) so adding a row never shifts the layout.
// The two column lists share the remaining width; their chips wrap.
const TABLE_COLUMNS = [
  { label: "Name", width: 240 },
  { label: "Column", width: undefined },
  { label: "Foreign table", width: 180 },
  { label: "Foreign column", width: undefined },
  { label: "On update", width: 124 },
  { label: "On delete", width: 124 },
  { label: "", width: 96 },
];

function ColumnChips({ columns }: { columns: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {columns.map((c) => (
        <Chip key={c} size="sm" variant="secondary" className="font-mono">
          <Chip.Label>{c}</Chip.Label>
        </Chip>
      ))}
    </div>
  );
}

function ActionLabel({ action }: { action: ReferentialAction }) {
  return (
    <span className={`font-mono text-[11px] ${action === "NO ACTION" ? "text-muted" : "text-foreground"}`}>
      {action}
    </span>
  );
}

function qualifiedTable(fk: ForeignKey): string {
  return fk.referencedSchema ? `${fk.referencedSchema}.${fk.referencedTable}` : fk.referencedTable;
}

// ── Pending row ──────────────────────────────────────────────────────────────

interface PendingForeignKeyRowProps {
  connectionId: string | null;
  database: string | null;
  fk: PendingForeignKey;
  columns: string[];
  tables: string[];
  actions: readonly ReferentialAction[];
  onUpdate: (tempId: string, update: (fk: PendingForeignKey) => PendingForeignKey) => void;
  onDiscard: (tempId: string) => void;
}

// Its own component so each row can load the columns of its chosen foreign table
function PendingForeignKeyRow({
  connectionId,
  database,
  fk,
  columns,
  tables,
  actions,
  onUpdate,
  onDiscard,
}: PendingForeignKeyRowProps) {
  const { tempId } = fk;
  const onChange = (update: (fk: PendingForeignKey) => PendingForeignKey) => onUpdate(tempId, update);

  const refStructure = useFetchTableStructure(connectionId, database, fk.referencedTable || null);
  const refColumns = refStructure.data?.columns ?? [];
  const primaryKeys = refColumns.filter((c) => c.isPrimary);
  const singlePrimaryKey = primaryKeys.length === 1 ? primaryKeys[0].name : null;

  // Point at the foreign table's primary key once its columns load
  useEffect(() => {
    if (!fk.referencedColumn && singlePrimaryKey) {
      onUpdate(tempId, (f) => ({ ...f, referencedColumn: singlePrimaryKey }));
    }
  }, [tempId, fk.referencedColumn, singlePrimaryKey, onUpdate]);

  const refColumnPlaceholder = !fk.referencedTable
    ? "pick a table first"
    : refStructure.isLoading
      ? "loading…"
      : "column";

  return (
    <tr style={{ background: NEW_ROW_TINT }}>
      <td className="px-2.5 py-1.5">
        <div className={`${fieldBoxClass} w-full`}>
          <input
            value={fk.name}
            placeholder="foreign_key_name"
            onChange={(e) =>
              onChange((f) => ({
                ...f,
                name: e.target.value,
                // Clearing the name hands it back to the auto-namer
                nameTouched: e.target.value !== "",
              }))
            }
            className={inputClass}
          />
        </div>
      </td>
      <td className="px-2.5 py-1.5">
        <FieldSelect
          label="Column"
          value={fk.column}
          options={columns}
          placeholder="column"
          onChange={(column) => onChange((f) => ({ ...f, column }))}
        />
      </td>
      <td className="px-2.5 py-1.5">
        <FieldSelect
          label="Foreign table"
          value={fk.referencedTable}
          options={tables}
          placeholder="table"
          // A new table resets the column so it can default to that table's primary key
          onChange={(referencedTable) => onChange((f) => ({ ...f, referencedTable, referencedColumn: "" }))}
        />
      </td>
      <td className="px-2.5 py-1.5">
        <FieldSelect
          label="Foreign column"
          value={fk.referencedColumn}
          options={refColumns.map((c) => c.name)}
          placeholder={refColumnPlaceholder}
          isDisabled={!fk.referencedTable || refColumns.length === 0}
          onChange={(referencedColumn) => onChange((f) => ({ ...f, referencedColumn }))}
        />
      </td>
      <td className="px-2.5 py-1.5">
        <FieldSelect
          label="On update"
          value={fk.onUpdate}
          options={actions}
          onChange={(onUpdate) => onChange((f) => ({ ...f, onUpdate }))}
        />
      </td>
      <td className="px-2.5 py-1.5">
        <FieldSelect
          label="On delete"
          value={fk.onDelete}
          options={actions}
          onChange={(onDelete) => onChange((f) => ({ ...f, onDelete }))}
        />
      </td>
      <td className="px-2.5 py-1.5">
        <NewRowActions onDiscard={() => onDiscard(tempId)} />
      </td>
    </tr>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function ForeignKeysTable({ connectionId, database, table, scopeKey }: ForeignKeysTableProps) {
  const applyChanges = useApplyForeignKeyChanges();
  const foreignKeysQuery = useFetchTableForeignKeys(connectionId, database, table);
  const structureQuery = useFetchTableStructure(connectionId, database, table);
  const tablesQuery = useListTables(connectionId, database);

  const foreignKeys = useMemo(() => foreignKeysQuery.data ?? [], [foreignKeysQuery.data]);
  const columns = useMemo(() => structureQuery.data?.columns ?? [], [structureQuery.data]);
  const dialect = structureQuery.data?.dialect ?? "postgres";
  const readOnlyReason = FOREIGN_KEYS_READ_ONLY_REASON[dialect];
  const actions = REFERENTIAL_ACTIONS[dialect] ?? REFERENTIAL_ACTIONS.postgres;
  const tableNames = useMemo(
    () => (tablesQuery.data ?? []).filter((t) => t.tableType === "table").map((t) => t.name),
    [tablesQuery.data],
  );

  // Staged changes outlive this component, so leaving the tab or table keeps them
  const [pendingDrops, setPendingDrops] = useStructureDraftField("foreignKeys", scopeKey, "drops");
  const [pendingAdds, setPendingAdds] = useStructureDraftField("foreignKeys", scopeKey, "adds");

  // ── Edit helpers ─────────────────────────────────────────────────────────

  const toggleDrop = useCallback((name: string) => {
    setPendingDrops((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }, [setPendingDrops]);

  const addForeignKey = useCallback(() => {
    setPendingAdds((prev) => [...prev, newPendingForeignKey(table)]);
  }, [table, setPendingAdds]);

  const updateAdd = useCallback(
    (tempId: string, update: (fk: PendingForeignKey) => PendingForeignKey) => {
      setPendingAdds((prev) =>
        prev.map((a) => (a.tempId === tempId ? withAutoName(table, update(a)) : a)),
      );
    },
    [table, setPendingAdds],
  );

  const removeAdd = useCallback((tempId: string) => {
    setPendingAdds((prev) => prev.filter((a) => a.tempId !== tempId));
  }, [setPendingAdds]);

  // ── Validation ───────────────────────────────────────────────────────────

  const validationError = useMemo(() => {
    const taken = new Set(
      foreignKeys.flatMap((f) => (f.name && !pendingDrops.includes(f.name) ? [f.name.toLowerCase()] : [])),
    );
    for (const add of pendingAdds) {
      const name = add.name.trim();
      if (!name) return "Every new foreign key needs a name.";
      if (taken.has(name.toLowerCase())) return `A foreign key named "${name}" already exists.`;
      taken.add(name.toLowerCase());
      // MySQL rejects re-adding a constraint name in the ALTER TABLE that drops it
      if (dialect === "mysql" && pendingDrops.some((d) => d.toLowerCase() === name.toLowerCase())) {
        return `MySQL can't reuse the name "${name}" in the same save that drops it. Pick another name, or save the drop first.`;
      }
      if (!add.column) return `Foreign key "${name}" needs a column.`;
      if (!add.referencedTable) return `Foreign key "${name}" needs a foreign table.`;
      if (!add.referencedColumn) return `Foreign key "${name}" needs a foreign column.`;
      const usesSetNull = add.onUpdate === "SET NULL" || add.onDelete === "SET NULL";
      if (usesSetNull && columns.find((c) => c.name === add.column)?.isNullable === false) {
        return `Column "${add.column}" is NOT NULL, so foreign key "${name}" can't use SET NULL.`;
      }
    }
    return null;
  }, [foreignKeys, pendingDrops, pendingAdds, columns, dialect]);

  // ── Save / Cancel ────────────────────────────────────────────────────────

  const pendingCount = pendingDrops.length + pendingAdds.length;

  const { reset: resetApply } = applyChanges;
  const cancelAll = useCallback(() => {
    useStructureDraftsStore.getState().clearDraft("foreignKeys", scopeKey);
    resetApply();
  }, [resetApply, scopeKey]);

  const saveAll = useCallback(() => {
    if (!connectionId || pendingCount === 0 || validationError) return;
    applyChanges.mutate(
      {
        connectionId,
        database,
        table,
        scopeKey,
        changes: {
          drops: pendingDrops,
          adds: pendingAdds.map((a) => ({
            name: a.name,
            columns: [a.column],
            referencedTable: a.referencedTable,
            referencedColumns: [a.referencedColumn],
            onUpdate: a.onUpdate,
            onDelete: a.onDelete,
          })),
        },
      },
      { onSuccess: () => resetApply() },
    );
  }, [
    connectionId,
    database,
    table,
    pendingCount,
    validationError,
    pendingDrops,
    pendingAdds,
    scopeKey,
    resetApply,
    applyChanges,
  ]);

  const saving = applyChanges.isPending;
  const saveError = applyChanges.error ? getErrorMessage(applyChanges.error, "Failed to apply changes") : null;

  // ── Render ───────────────────────────────────────────────────────────────

  if (foreignKeysQuery.isLoading || structureQuery.isLoading) return <LoadingState />;

  const loadError = foreignKeysQuery.error ?? structureQuery.error;
  if (loadError) return <LoadErrorState error={loadError} fallback="Failed to load foreign keys" />;

  return (
    <div className="flex-1 flex flex-col min-h-0 h-full bg-surface">
      <StructureToolbar
        summary={`${foreignKeys.length} foreign keys`}
        pendingCount={pendingCount}
        addLabel="Add foreign key"
        onAdd={addForeignKey}
        addDisabledReason={readOnlyReason}
      />

      <SaveStatusBanner saveError={saveError} validationError={validationError} />

      {/* Foreign keys table */}
      <div className="flex-1 overflow-auto px-3.5">
        <table className="w-full table-fixed border-collapse text-xs">
          <colgroup>
            {TABLE_COLUMNS.map((c, i) => (
              <col key={i} style={{ width: c.width }} />
            ))}
          </colgroup>
          <thead>
            <tr className="sticky top-0 z-[1] bg-surface">
              {TABLE_COLUMNS.map((h, i) => (
                <th
                  key={i}
                  className="py-2.5 px-2.5 text-muted font-medium text-[11px] whitespace-nowrap text-left"
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {foreignKeys.map((fk, i) => {
              const dropName = readOnlyReason ? null : fk.name;
              const isDropped = !!dropName && pendingDrops.includes(dropName);
              return (
                <tr
                  key={fk.name ?? `fk-${i}`}
                  style={{
                    background: isDropped ? DELETED_ROW_TINT : undefined,
                    opacity: isDropped ? 0.55 : 1,
                  }}
                >
                  <td className="px-2.5 py-2 font-mono">
                    {fk.name ? (
                      <span
                        title={fk.name}
                        className="block truncate"
                        style={{ textDecoration: isDropped ? "line-through" : undefined }}
                      >
                        {fk.name}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-2.5 py-2">
                    <ColumnChips columns={fk.columns} />
                  </td>
                  <td className="px-2.5 py-2 font-mono">
                    <span title={qualifiedTable(fk)} className="block truncate">
                      {qualifiedTable(fk)}
                    </span>
                  </td>
                  <td className="px-2.5 py-2">
                    <ColumnChips columns={fk.referencedColumns} />
                  </td>
                  <td className="px-2.5 py-2">
                    <ActionLabel action={fk.onUpdate} />
                  </td>
                  <td className="px-2.5 py-2">
                    <ActionLabel action={fk.onDelete} />
                  </td>
                  <td className="px-2.5 py-2">
                    <RowActions>
                      {!dropName ? (
                        <HintIcon
                          hint={readOnlyReason ?? "This foreign key has no name to drop it by"}
                          className="text-muted opacity-60"
                        >
                          <LuLock size={12} />
                        </HintIcon>
                      ) : isDropped ? (
                        <UndoButton onPress={() => toggleDrop(dropName)} />
                      ) : (
                        <RowIconButton label="Drop foreign key" onPress={() => toggleDrop(dropName)}>
                          <LuTrash2 size={12} />
                        </RowIconButton>
                      )}
                    </RowActions>
                  </td>
                </tr>
              );
            })}

            {/* Pending adds */}
            {pendingAdds.map((a) => (
              <PendingForeignKeyRow
                key={a.tempId}
                connectionId={connectionId}
                database={database}
                fk={a}
                columns={columns.map((c) => c.name)}
                tables={tableNames}
                actions={actions}
                onUpdate={updateAdd}
                onDiscard={removeAdd}
              />
            ))}

            {foreignKeys.length === 0 && pendingAdds.length === 0 && (
              <tr>
                <td colSpan={TABLE_COLUMNS.length} className="text-center py-12 text-sm text-muted">
                  No foreign keys
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <SaveBar
        pendingCount={pendingCount}
        saving={saving}
        saveDisabled={!!validationError}
        onCancel={cancelAll}
        onSave={saveAll}
      />
    </div>
  );
}
