import { Alert, Button, Spinner, Tooltip } from "@heroui/react";
import { LuPlus, LuUndo2, LuX } from "react-icons/lu";
import { getErrorMessage } from "../../../lib/error";

// Pieces shared by the Columns, Indexes, and Foreign Keys tabs, built on HeroUI controls.

export const fieldBoxClass = "h-[30px] rounded-md bg-surface border border-separator flex items-center";
export const inputClass =
  "flex-1 bg-transparent border-none outline-none text-foreground text-xs font-mono px-2.5 w-full min-w-0";

// Pre-encoded SVG chevron for native select styling (avoids encodeURIComponent on every render)
export const SELECT_CHEVRON_BG = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='${encodeURIComponent("rgba(180,180,200,0.7)")}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M6 9l6 6 6-6'/></svg>")`;

// Postgres truncates identifiers at 63 bytes; MySQL allows 64
export const MAX_IDENTIFIER_LENGTH = 63;

// Row tint for staged-but-unsaved additions
export const NEW_ROW_TINT = "color-mix(in oklch, oklch(73% 0.18 153) 8%, transparent)";
const NEW_ROW_ACCENT = "oklch(73% 0.18 153)";
// Row tint for staged deletions
export const DELETED_ROW_TINT = "color-mix(in oklch, oklch(65% 0.2 25) 12%, transparent)";

// ── Centered states (loading / load error) ───────────────────────────────────

export function CenteredState({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 flex items-center justify-center px-6">{children}</div>;
}

export function LoadingState() {
  return (
    <CenteredState>
      <Spinner size="sm" />
    </CenteredState>
  );
}

export function LoadErrorState({ error, fallback }: { error: unknown; fallback: string }) {
  return (
    <CenteredState>
      <StatusAlert status="danger">{getErrorMessage(error, fallback)}</StatusAlert>
    </CenteredState>
  );
}

// ── Status alert (save / validation / load errors) ───────────────────────────

interface StatusAlertProps {
  status: "danger" | "warning";
  /** Full-width strip under a toolbar instead of a centered box */
  banner?: boolean;
  children: React.ReactNode;
}

// HeroUI's Alert is top-aligned for title + description; a one-line message
// needs to be centered on the (24px) indicator instead.
export function StatusAlert({ status, banner, children }: StatusAlertProps) {
  const layout = banner ? "rounded-none border-b border-separator px-4.5 py-2 shrink-0" : "max-w-md";
  return (
    <Alert status={status} className={`items-center gap-2.5 ${layout}`}>
      <Alert.Indicator />
      <Alert.Content className="justify-center">
        <Alert.Description className="text-xs">{children}</Alert.Description>
      </Alert.Content>
    </Alert>
  );
}

// ── Row actions ──────────────────────────────────────────────────────────────

/** Right-aligned, vertically centered action area of a row */
export function RowActions({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-end gap-2">{children}</div>;
}

interface RowIconButtonProps {
  label: string;
  onPress: () => void;
  className?: string;
  children: React.ReactNode;
}

export function RowIconButton({ label, onPress, className = "size-6.5 min-w-0 text-muted", children }: RowIconButtonProps) {
  return (
    <Button size="sm" variant="ghost" isIconOnly aria-label={label} onPress={onPress} className={className}>
      {children}
    </Button>
  );
}

// pointer-events: auto because a deleted row disables pointer events on itself
export function UndoButton({ onPress }: { onPress: () => void }) {
  return (
    <Button
      size="sm"
      variant="outline"
      onPress={onPress}
      style={{ pointerEvents: "auto" }}
      className="h-6 px-2.5 gap-1.5 text-[11px]"
    >
      <LuUndo2 size={10} /> Undo
    </Button>
  );
}

export function NewRowActions({ onDiscard }: { onDiscard: () => void }) {
  return (
    <RowActions>
      <span className="text-[10.5px] font-semibold leading-none" style={{ color: NEW_ROW_ACCENT }}>
        New
      </span>
      <RowIconButton label="Discard" onPress={onDiscard}>
        <LuX size={12} />
      </RowIconButton>
    </RowActions>
  );
}

interface HintProps {
  hint: string;
  className?: string;
  children: React.ReactNode;
}

/** Explains its (non-interactive or disabled) content on hover or keyboard focus */
export function Hint({ hint, className = "", children }: HintProps) {
  return (
    <Tooltip>
      <Tooltip.Trigger>
        <span tabIndex={0} aria-label={hint} className={`outline-none ${className}`}>
          {children}
        </span>
      </Tooltip.Trigger>
      <Tooltip.Content>{hint}</Tooltip.Content>
    </Tooltip>
  );
}

/** A row-sized icon that explains itself */
export function HintIcon({ hint, className = "", children }: HintProps) {
  return (
    <Hint hint={hint} className={`size-6.5 inline-grid place-items-center ${className}`}>
      {children}
    </Hint>
  );
}

// ── Field select (native select styled like the text fields) ─────────────────

interface FieldSelectProps<T extends string> {
  label: string;
  value: T | "";
  options: readonly T[];
  onChange: (value: T) => void;
  /** Shown while value is "" */
  placeholder?: string;
  isDisabled?: boolean;
}

export function FieldSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder,
  isDisabled,
}: FieldSelectProps<T>) {
  return (
    <div className={`${fieldBoxClass} w-full`} style={{ opacity: isDisabled ? 0.5 : 1 }}>
      <select
        aria-label={label}
        value={value}
        disabled={isDisabled}
        onChange={(e) => {
          const picked = options.find((o) => o === e.target.value);
          if (picked !== undefined) onChange(picked);
        }}
        className="appearance-none bg-transparent border-none text-xs font-mono outline-none cursor-pointer disabled:cursor-default pl-2.5 pr-5 h-full w-full min-w-0 truncate"
        style={{
          color: value ? "var(--foreground)" : "var(--muted)",
          backgroundImage: SELECT_CHEVRON_BG,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 5px center",
        }}
      >
        {placeholder !== undefined && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

interface StructureToolbarProps {
  /** e.g. "12 columns" */
  summary: string;
  pendingCount: number;
  addLabel: string;
  onAdd: () => void;
  /** Disables the add button and explains why on hover */
  addDisabledReason?: string;
}

export function StructureToolbar({ summary, pendingCount, addLabel, onAdd, addDisabledReason }: StructureToolbarProps) {
  const addButton = (
    <Button size="sm" variant="secondary" className="h-7 text-xs gap-1.5" isDisabled={!!addDisabledReason} onPress={onAdd}>
      <LuPlus size={11} /> {addLabel}
    </Button>
  );
  return (
    <div className="h-11 px-4.5 flex items-center gap-2.5 border-b border-separator shrink-0">
      <div className="flex-1" />
      <span className="text-muted text-[11px] font-mono">
        {summary}
        {pendingCount > 0 && <span className="text-foreground"> · {pendingCount} unsaved</span>}
      </span>
      {addDisabledReason ? (
        // A disabled button gets no hover events, so the wrapper carries the tooltip
        <Hint hint={addDisabledReason} className="inline-flex">
          {addButton}
        </Hint>
      ) : (
        addButton
      )}
    </div>
  );
}

// ── Save / Cancel bar ────────────────────────────────────────────────────────

interface SaveBarProps {
  pendingCount: number;
  saving: boolean;
  saveDisabled?: boolean;
  onCancel: () => void;
  onSave: () => void;
}

export function SaveBar({ pendingCount, saving, saveDisabled, onCancel, onSave }: SaveBarProps) {
  return (
    <div className="px-4.5 py-3 flex items-center gap-2 shrink-0">
      <div className="flex-1" />
      <Button size="sm" variant="outline" className="text-xs" isDisabled={pendingCount === 0} onPress={onCancel}>
        Cancel
      </Button>
      <Button
        size="sm"
        variant="primary"
        className="text-xs"
        isDisabled={pendingCount === 0 || saving || saveDisabled}
        onPress={onSave}
      >
        {saving ? <Spinner size="sm" /> : `Save changes${pendingCount > 0 ? ` (${pendingCount})` : ""}`}
      </Button>
    </div>
  );
}
