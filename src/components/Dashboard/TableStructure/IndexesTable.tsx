import { useCallback, useMemo, useState } from "react";
import { Button, Chip, Dropdown, Input, Label, Switch } from "@heroui/react";
import { LuArrowDown, LuArrowUp, LuCheck, LuLock, LuPlus, LuTrash2, LuX } from "react-icons/lu";
import { KeyIcon } from "../shared/icons";
import { useApplyIndexChanges, useFetchTableIndexes, useFetchTableStructure } from "../../../hooks/useTables";
import { getErrorMessage } from "../../../lib/error";
import type { IndexColumnPayload, StructureColumn, TableIndex } from "../../../types/database";
import {
  DELETED_ROW_TINT,
  HintIcon,
  LoadErrorState,
  LoadingState,
  NEW_ROW_TINT,
  NewRowActions,
  RowActions,
  RowIconButton,
  SaveBar,
  StatusAlert,
  StructureToolbar,
  UndoButton,
  fieldBoxClass,
  inputClass,
} from "./shared";

interface PendingIndex {
  tempId: string;
  name: string;
  /** Once the user edits the name it stops following the columns */
  nameTouched: boolean;
  unique: boolean;
  columns: IndexColumnPayload[];
}

/** Pre-fills a new index when arriving from the Columns tab's Key menu */
export interface IndexSeed {
  column: string;
  unique: boolean;
}

interface IndexesTableProps {
  connectionId: string | null;
  database: string | null;
  table: string;
  seed: IndexSeed | null;
}

// Postgres truncates identifiers at 63 bytes; MySQL allows 64
const MAX_INDEX_NAME = 63;

// MySQL can only index these with a prefix length (error 1170)
const MYSQL_PREFIX_TYPES = new Set([
  "tinytext", "text", "mediumtext", "longtext",
  "tinyblob", "blob", "mediumblob", "longblob",
]);

// Table-prefixed because Postgres index names are unique per schema, not per table
function autoIndexName(table: string, columns: string[], unique: boolean): string {
  const parts = [table, ...columns, unique ? "key" : "idx"];
  return parts.join("_").slice(0, MAX_INDEX_NAME);
}

function withAutoName(table: string, index: PendingIndex): PendingIndex {
  if (index.nameTouched) return index;
  return { ...index, name: autoIndexName(table, index.columns.map((c) => c.name), index.unique) };
}

function newPendingIndex(table: string, column?: string, unique = false): PendingIndex {
  return withAutoName(table, {
    tempId: crypto.randomUUID(),
    name: "",
    nameTouched: false,
    unique,
    columns: column ? [{ name: column, descending: false, prefixLength: null }] : [],
  });
}

// Fixed column widths (table-layout: fixed) so adding a row never shifts the layout.
// Columns takes the remaining width; its chips wrap.
const TABLE_COLUMNS = [
  { label: "Name", align: "left" as const, width: 300 },
  { label: "Columns", align: "left" as const, width: undefined },
  { label: "Unique", align: "center" as const, width: 72 },
  { label: "Type", align: "left" as const, width: 80 },
  { label: "", align: "left" as const, width: 96 },
];

// Compact icon buttons that sit inside a column chip
const chipIconButtonClass = "size-4 min-w-0 p-0 text-muted";

function lockReason(index: TableIndex): string {
  return index.isPrimary
    ? "The primary key is read-only"
    : "Created by a column constraint, so it can't be dropped on its own";
}

// ── Main Component ───────────────────────────────────────────────────────────

export function IndexesTable({ connectionId, database, table, seed }: IndexesTableProps) {
  const applyChanges = useApplyIndexChanges();
  const indexesQuery = useFetchTableIndexes(connectionId, database, table);
  const structureQuery = useFetchTableStructure(connectionId, database, table);

  const indexes = useMemo(() => indexesQuery.data ?? [], [indexesQuery.data]);
  const columns = useMemo(() => structureQuery.data?.columns ?? [], [structureQuery.data]);
  const dialect = structureQuery.data?.dialect ?? "postgres";
  const columnsByName = useMemo(
    () => new Map<string, StructureColumn>(columns.map((c) => [c.name, c])),
    [columns],
  );

  const [pendingDrops, setPendingDrops] = useState<string[]>([]);
  const [pendingAdds, setPendingAdds] = useState<PendingIndex[]>(() =>
    seed ? [newPendingIndex(table, seed.column, seed.unique)] : [],
  );

  const needsPrefix = useCallback(
    (column: string) =>
      dialect === "mysql" && MYSQL_PREFIX_TYPES.has(columnsByName.get(column)?.dataType ?? ""),
    [dialect, columnsByName],
  );

  // ── Edit helpers ─────────────────────────────────────────────────────────

  const toggleDrop = useCallback((name: string) => {
    setPendingDrops((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }, []);

  const addIndex = useCallback(() => {
    setPendingAdds((prev) => [...prev, newPendingIndex(table)]);
  }, [table]);

  const updateAdd = useCallback(
    (tempId: string, update: (index: PendingIndex) => PendingIndex) => {
      setPendingAdds((prev) =>
        prev.map((a) => (a.tempId === tempId ? withAutoName(table, update(a)) : a)),
      );
    },
    [table],
  );

  const updateColumns = useCallback(
    (tempId: string, update: (cols: IndexColumnPayload[]) => IndexColumnPayload[]) =>
      updateAdd(tempId, (idx) => ({ ...idx, columns: update(idx.columns) })),
    [updateAdd],
  );

  const patchColumn = useCallback(
    (tempId: string, position: number, patch: Partial<IndexColumnPayload>) =>
      updateColumns(tempId, (cols) => cols.map((c, j) => (j === position ? { ...c, ...patch } : c))),
    [updateColumns],
  );

  const removeAdd = useCallback((tempId: string) => {
    setPendingAdds((prev) => prev.filter((a) => a.tempId !== tempId));
  }, []);

  // ── Validation ───────────────────────────────────────────────────────────

  const validationError = useMemo(() => {
    const taken = new Set(
      indexes.filter((i) => !pendingDrops.includes(i.name)).map((i) => i.name.toLowerCase()),
    );
    for (const add of pendingAdds) {
      const name = add.name.trim();
      if (!name) return "Every new index needs a name.";
      if (taken.has(name.toLowerCase())) return `An index named "${name}" already exists.`;
      taken.add(name.toLowerCase());
      if (add.columns.length === 0) return `Index "${name}" needs at least one column.`;
      const missingPrefix = add.columns.find((c) => needsPrefix(c.name) && !c.prefixLength);
      if (missingPrefix) {
        return `Column "${missingPrefix.name}" needs a prefix length to be indexed on MySQL.`;
      }
    }
    return null;
  }, [indexes, pendingDrops, pendingAdds, needsPrefix]);

  // ── Save / Cancel ────────────────────────────────────────────────────────

  const pendingCount = pendingDrops.length + pendingAdds.length;

  const { reset: resetApply } = applyChanges;
  const cancelAll = useCallback(() => {
    setPendingDrops([]);
    setPendingAdds([]);
    resetApply();
  }, [resetApply]);

  const saveAll = useCallback(() => {
    if (!connectionId || pendingCount === 0 || validationError) return;
    applyChanges.mutate(
      {
        connectionId,
        database,
        table,
        changes: {
          drops: pendingDrops,
          adds: pendingAdds.map((a) => ({ name: a.name, unique: a.unique, columns: a.columns })),
        },
      },
      { onSuccess: cancelAll },
    );
  }, [
    connectionId,
    database,
    table,
    pendingCount,
    validationError,
    pendingDrops,
    pendingAdds,
    applyChanges,
    cancelAll,
  ]);

  const saving = applyChanges.isPending;
  const saveError = applyChanges.error ? getErrorMessage(applyChanges.error, "Failed to apply changes") : null;

  // ── Render ───────────────────────────────────────────────────────────────

  if (indexesQuery.isLoading || structureQuery.isLoading) return <LoadingState />;

  const loadError = indexesQuery.error ?? structureQuery.error;
  if (loadError) return <LoadErrorState error={loadError} fallback="Failed to load indexes" />;

  return (
    <div className="flex-1 flex flex-col min-h-0 h-full bg-surface">
      <StructureToolbar
        summary={`${indexes.length} indexes`}
        pendingCount={pendingCount}
        addLabel="Add index"
        onAdd={addIndex}
      />

      {saveError ? (
        <StatusAlert status="danger" banner>
          {saveError}
        </StatusAlert>
      ) : validationError ? (
        <StatusAlert status="warning" banner>
          {validationError}
        </StatusAlert>
      ) : null}

      {/* Indexes table */}
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
                  className="py-2.5 px-2.5 text-muted font-medium text-[11px] whitespace-nowrap"
                  style={{ textAlign: h.align }}
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {indexes.map((index) => {
              const isDropped = pendingDrops.includes(index.name);
              return (
                <tr
                  key={index.name}
                  style={{
                    background: isDropped ? DELETED_ROW_TINT : undefined,
                    opacity: isDropped ? 0.55 : 1,
                  }}
                >
                  <td className="px-2.5 py-2 font-mono">
                    <span className="flex items-center gap-2 min-w-0">
                      <span
                        title={index.name}
                        className="truncate"
                        style={{ textDecoration: isDropped ? "line-through" : undefined }}
                      >
                        {index.name}
                      </span>
                      {index.isPrimary && (
                        <Chip size="sm" color="warning" variant="soft" className="font-sans shrink-0">
                          <KeyIcon size={10} />
                          <Chip.Label>PK</Chip.Label>
                        </Chip>
                      )}
                    </span>
                  </td>
                  <td className="px-2.5 py-2">
                    <div className="flex flex-wrap gap-1">
                      {index.columns.map((c, i) => (
                        <Chip key={i} size="sm" variant="secondary" className={`font-mono ${c.isExpression ? "italic" : ""}`}>
                          <Chip.Label>
                            {c.name}
                            {c.prefixLength ? <span className="text-muted">({c.prefixLength})</span> : null}
                          </Chip.Label>
                          {c.descending ? <LuArrowDown size={10} className="text-muted" /> : null}
                        </Chip>
                      ))}
                    </div>
                  </td>
                  <td className="px-2.5 py-2 text-center">
                    {index.isUnique ? (
                      <LuCheck size={13} className="inline text-foreground" />
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-2.5 py-2 text-muted font-mono text-[11px] lowercase">
                    {index.method ?? ""}
                  </td>
                  <td className="px-2.5 py-2">
                    <RowActions>
                      {!index.droppable ? (
                        <HintIcon hint={lockReason(index)} className="text-muted opacity-60">
                          <LuLock size={12} />
                        </HintIcon>
                      ) : isDropped ? (
                        <UndoButton onPress={() => toggleDrop(index.name)} />
                      ) : (
                        <RowIconButton label="Drop index" onPress={() => toggleDrop(index.name)}>
                          <LuTrash2 size={12} />
                        </RowIconButton>
                      )}
                    </RowActions>
                  </td>
                </tr>
              );
            })}

            {/* Pending adds */}
            {pendingAdds.map((a) => {
              const available = columns.filter((c) => !a.columns.some((ac) => ac.name === c.name));
              return (
                <tr key={a.tempId} style={{ background: NEW_ROW_TINT }}>
                  <td className="px-2.5 py-1.5">
                    <div className={`${fieldBoxClass} w-full`}>
                      <input
                        value={a.name}
                        placeholder="index_name"
                        onChange={(e) =>
                          updateAdd(a.tempId, (idx) => ({
                            ...idx,
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
                    <div className="flex flex-wrap items-center gap-1">
                      {a.columns.map((c, i) => (
                        <Chip key={c.name} size="sm" variant="secondary" className="font-mono">
                          <Chip.Label>{c.name}</Chip.Label>
                          {needsPrefix(c.name) && (
                            <Input
                              value={c.prefixLength ?? ""}
                              placeholder="len"
                              inputMode="numeric"
                              aria-label="Prefix length (required by MySQL for text/blob columns)"
                              onChange={(e) => {
                                const len = Number.parseInt(e.target.value, 10);
                                patchColumn(a.tempId, i, { prefixLength: len > 0 ? len : null });
                              }}
                              className="w-10 h-[18px] min-h-0 px-1 text-[10.5px] font-mono"
                            />
                          )}
                          <RowIconButton
                            label={c.descending ? "Descending — click for ascending" : "Ascending — click for descending"}
                            onPress={() => patchColumn(a.tempId, i, { descending: !c.descending })}
                            className={chipIconButtonClass}
                          >
                            {c.descending ? <LuArrowDown size={10} /> : <LuArrowUp size={10} />}
                          </RowIconButton>
                          <RowIconButton
                            label="Remove column"
                            onPress={() => updateColumns(a.tempId, (cols) => cols.filter((_, j) => j !== i))}
                            className={chipIconButtonClass}
                          >
                            <LuX size={10} />
                          </RowIconButton>
                        </Chip>
                      ))}
                      {available.length > 0 && (
                        <Dropdown>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 min-w-0 px-2 text-[11px] text-muted gap-1"
                          >
                            <LuPlus size={10} /> column
                          </Button>
                          <Dropdown.Popover className="w-[200px] p-1 max-h-[280px] overflow-auto">
                            <Dropdown.Menu
                              onAction={(key) =>
                                updateColumns(a.tempId, (cols) => [
                                  ...cols,
                                  { name: String(key), descending: false, prefixLength: null },
                                ])
                              }
                            >
                              {available.map((c) => (
                                <Dropdown.Item key={c.name} id={c.name} textValue={c.name}>
                                  <Label className="font-mono text-xs">{c.name}</Label>
                                </Dropdown.Item>
                              ))}
                            </Dropdown.Menu>
                          </Dropdown.Popover>
                        </Dropdown>
                      )}
                    </div>
                  </td>
                  <td className="px-2.5 py-1.5 text-center">
                    <Switch
                      size="sm"
                      aria-label="Unique"
                      isSelected={a.unique}
                      onChange={(unique) => updateAdd(a.tempId, (idx) => ({ ...idx, unique }))}
                    >
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                    </Switch>
                  </td>
                  <td className="px-2.5 py-1.5" />
                  <td className="px-2.5 py-1.5">
                    <NewRowActions onDiscard={() => removeAdd(a.tempId)} />
                  </td>
                </tr>
              );
            })}

            {indexes.length === 0 && pendingAdds.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-12 text-sm text-muted">
                  No indexes
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
