import { useEffect, useRef, useState } from "react";
import type { ColumnInfo } from "../../../types/database";
import { parseEditValue } from "../../../lib/parseValue";
import { getTypeColor } from "../../../lib/typeColors";

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
  column: ColumnInfo;
  originalValue: unknown;
  dirtyValue: unknown | undefined;
  isDirty: boolean;
  isSaved?: boolean;
  editable: boolean;
  onCommit: (newValue: unknown) => void;
}

export function InspectorEditableField({
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
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);

  const displayValue = isDirty ? dirtyValue : originalValue;
  const color = getTypeColor(column.dataType);

  useEffect(() => {
    if (isEditing) {
      committedRef.current = false;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(inputRef.current.value.length, inputRef.current.value.length);
    }
  }, [isEditing]);

  const handleDoubleClick = () => {
    if (!editable) return;
    const val = displayValue === null || displayValue === undefined ? "" : String(displayValue);
    setInputValue(val);
    setIsEditing(true);
  };

  const doCommit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    const parsed = parseEditValue(inputValue, column.dataType, column.isNullable);
    onCommit(parsed);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        className="w-full bg-transparent border-none outline-none font-mono text-xs text-foreground"
        style={{
          background: "color-mix(in oklch, var(--warning) 10%, transparent)",
          borderRadius: 3,
          padding: "2px 4px",
          margin: "-2px -4px",
        }}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={doCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
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
    <span
      className={`truncate${editable ? " cursor-pointer" : ""}`}
      onDoubleClick={handleDoubleClick}
      style={isDirty ? dirtyFieldStyle : isSaved ? savedFieldStyle : undefined}
    >
      {formattedValue}
    </span>
  );
}



