import { useEffect, useRef, useState } from "react";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react";
import type { ColumnInfo } from "../../../types/database";
import { formatEditValue, isJsonValue, isLongText, jsonEditError, parseEditValue } from "../../../lib/parseValue";
import { getTypeColor } from "../../../lib/typeColors";
import { ValueEditorModal } from "../shared/ValueEditorModal";

// ── Editable Field ───────────────────────────────────────────────────────────

const dirtyFieldStyle: React.CSSProperties = {
  background: "color-mix(in oklch, var(--warning) 8%, transparent)",
  borderRadius: 3,
  padding: "1px 4px",
  margin: "-1px -4px",
};
const savedFieldStyle: React.CSSProperties = {
  background: "color-mix(in oklch, var(--accent) 12%, transparent)",
  borderRadius: 3,
  padding: "1px 4px",
  margin: "-1px -4px",
};

interface EditableFieldProps {
  table: string | null;
  column: ColumnInfo;
  originalValue: unknown;
  dirtyValue: unknown | undefined;
  isDirty: boolean;
  isSaved?: boolean;
  editable: boolean;
  onCommit: (newValue: unknown) => void;
}

export function InspectorEditableField({
  table,
  column,
  originalValue,
  dirtyValue,
  isDirty,
  isSaved,
  editable,
  onCommit,
}: EditableFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  // Boxed so a NULL value can still mean "open"
  const [expanded, setExpanded] = useState<{ value: unknown } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);

  const displayValue = isDirty ? dirtyValue : originalValue;
  const color = getTypeColor(column.dataType);
  const isJson = isJsonValue(column.dataType, originalValue);
  const canExpand = editable && (isJson || isLongText(column.dataType, displayValue));

  useEffect(() => {
    if (isEditing) {
      committedRef.current = false;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(inputRef.current.value.length, inputRef.current.value.length);
    }
  }, [isEditing]);

  const handleDoubleClick = () => {
    if (!editable) return;
    setInputValue(formatEditValue(displayValue));
    setInputError(null);
    setIsEditing(true);
  };

  /** Returns false when the text is invalid JSON and the input stays open */
  const doCommit = () => {
    if (committedRef.current) return true;
    const error = isJson ? jsonEditError(inputValue, column.isNullable) : null;
    if (error) {
      setInputError(`Invalid JSON: ${error.message}`);
      return false;
    }
    committedRef.current = true;
    const parsed = parseEditValue(inputValue, column.dataType, column.isNullable, originalValue);
    onCommit(parsed);
    setIsEditing(false);
    return true;
  };

  const expandInput = () => {
    committedRef.current = true;
    setIsEditing(false);
    setExpanded({ value: inputValue });
  };

  const modal = expanded && (
    <ValueEditorModal
      table={table}
      column={column}
      value={expanded.value}
      original={originalValue}
      onApply={(raw) => {
        onCommit(parseEditValue(raw, column.dataType, column.isNullable, originalValue));
        setExpanded(null);
      }}
      onSetNull={() => {
        onCommit(null);
        setExpanded(null);
      }}
      onCancel={() => setExpanded(null)}
    />
  );

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        className="w-full bg-transparent border-none outline-none font-mono text-xs text-foreground"
        style={{
          background: `color-mix(in oklch, var(${inputError ? "--danger" : "--warning"}) 10%, transparent)`,
          boxShadow: inputError ? "inset 0 0 0 1px var(--danger)" : undefined,
          borderRadius: 3,
          padding: "2px 4px",
          margin: "-2px -4px",
        }}
        title={inputError ?? undefined}
        aria-invalid={!!inputError}
        value={inputValue}
        onChange={(e) => {
          setInputValue(e.target.value);
          setInputError(null);
        }}
        // Invalid text isn't thrown away on blur — it moves to the expanded editor instead
        onBlur={() => {
          if (!doCommit()) expandInput();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.shiftKey) {
            e.preventDefault();
            expandInput();
          } else if (e.key === "Enter") {
            e.preventDefault();
            doCommit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            committedRef.current = true;
            setIsEditing(false);
          }
        }}
      />
    );
  }

  const formattedValue =
    displayValue === null || displayValue === undefined ? (
      <span className="text-muted italic">null</span>
    ) : (
      <span style={{ color }}>{JSON.stringify(displayValue)}</span>
    );

  return (
    <>
      <span
        className={`truncate${editable ? " cursor-pointer" : ""}`}
        onDoubleClick={handleDoubleClick}
        style={isDirty ? dirtyFieldStyle : isSaved ? savedFieldStyle : undefined}
      >
        {formattedValue}
      </span>
      {canExpand && (
        <button
          type="button"
          aria-label={`Edit ${column.name} in editor`}
          title="Edit in editor"
          className="shrink-0 self-center rounded p-0.5 text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
          onClick={() => setExpanded({ value: displayValue })}
        >
          <ArrowsOutSimpleIcon size={11} />
        </button>
      )}
      {modal}
    </>
  );
}
