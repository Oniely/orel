import { Alert, Button, Spinner, Tooltip } from "@heroui/react";
import { LuPlus, LuUndo2, LuX } from "react-icons/lu";
import { getErrorMessage } from "../../../lib/error";

// Pieces shared by the Columns and Indexes tabs, built on HeroUI controls.

export const fieldBoxClass = "h-[30px] rounded-md bg-surface border border-separator flex items-center";
export const inputClass =
  "flex-1 bg-transparent border-none outline-none text-foreground text-xs font-mono px-2.5 w-full min-w-0";

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

/** A non-interactive icon that explains itself on hover or keyboard focus */
export function HintIcon({ hint, className = "", children }: { hint: string; className?: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <Tooltip.Trigger>
        <span tabIndex={0} aria-label={hint} className={`size-6.5 inline-grid place-items-center outline-none ${className}`}>
          {children}
        </span>
      </Tooltip.Trigger>
      <Tooltip.Content>{hint}</Tooltip.Content>
    </Tooltip>
  );
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

interface StructureToolbarProps {
  /** e.g. "12 columns" */
  summary: string;
  pendingCount: number;
  addLabel: string;
  onAdd: () => void;
}

export function StructureToolbar({ summary, pendingCount, addLabel, onAdd }: StructureToolbarProps) {
  return (
    <div className="h-11 px-4.5 flex items-center gap-2.5 border-b border-separator shrink-0">
      <div className="flex-1" />
      <span className="text-muted text-[11px] font-mono">
        {summary}
        {pendingCount > 0 && <span className="text-foreground"> · {pendingCount} unsaved</span>}
      </span>
      <Button size="sm" variant="secondary" className="h-7 text-xs gap-1.5" onPress={onAdd}>
        <LuPlus size={11} /> {addLabel}
      </Button>
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
