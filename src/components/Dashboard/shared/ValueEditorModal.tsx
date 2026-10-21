import { useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { Button, Kbd, Modal } from "@heroui/react";
import { WarningCircleIcon } from "@phosphor-icons/react";
import type { ColumnInfo } from "../../../types/database";
import { buildOrelTheme, THEME_DARK, THEME_LIGHT } from "../../../lib/monacoTheme";
import { formatEditValue, formatJsonForEditor, isJsonValue, jsonEditError } from "../../../lib/parseValue";
import { getTypeColor } from "../../../lib/typeColors";
import { THEMES } from "../../../lib/themes";
import { useThemeStore } from "../../../stores/theme.store";
import { usePlatform } from "../../../hooks/dashboard/useDashboardHotkeys";

// ── Expanded value editor ────────────────────────────────────────────────────

// Monaco's MarkerSeverity.Error
const MARKER_ERROR = 8;

interface ValueEditorModalProps {
  table: string | null;
  column: ColumnInfo;
  /** Value shown when the editor opens (pending value if the cell is dirty) */
  value: unknown;
  /** Value as loaded from the database — decides JSON mode */
  original: unknown;
  /** Receives the edited text — callers stage it the same way as an inline edit */
  onApply: (raw: string) => void;
  onSetNull: () => void;
  onCancel: () => void;
}

export function ValueEditorModal({ table, column, value, original, onApply, onSetNull, onCancel }: ValueEditorModalProps) {
  const isJson = isJsonValue(column.dataType, original);
  const [text, setText] = useState(() => (isJson ? formatJsonForEditor(value) : formatEditValue(value)));
  const [markerPos, setMarkerPos] = useState<{ line: number; column: number } | null>(null);
  const themeId = useThemeStore((s) => s.themeId);
  const theme = THEMES.find((t) => t.id === themeId) ?? THEMES.find((t) => t.id === "dark")!;
  const os = usePlatform();

  const error = isJson ? jsonEditError(text, column.isNullable) : null;
  // WebKit's JSON.parse gives no position — fall back to Monaco's own marker
  const line = error?.line ?? markerPos?.line;
  const col = error?.column ?? markerPos?.column;

  const apply = () => {
    if (!error) onApply(text);
  };
  const applyRef = useRef(apply);
  applyRef.current = apply;

  const handleMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => applyRef.current());
    editor.focus();
  };

  return (
    <Modal>
      <Modal.Backdrop
        isOpen
        isDismissable={false}
        isKeyboardDismissDisabled
        onOpenChange={(open) => {
          if (!open) onCancel();
        }}
      >
        <Modal.Container>
          <Modal.Dialog className="flex h-[70vh] w-full max-w-3xl flex-col overflow-hidden p-0">
            <div
              className="flex min-h-0 flex-1 flex-col"
              onKeyDown={(e) => {
                // Keys stop here so dashboard hotkeys behind the modal (inspector Esc / arrow-key
                // row navigation) don't fire. Tab is left alone for the modal's focus trap.
                if (e.key !== "Tab") e.stopPropagation();
                if (e.key === "Escape") {
                  e.preventDefault();
                  onCancel();
                } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  apply();
                }
              }}
            >
              <Modal.Header className="flex shrink-0 flex-row items-center gap-2 border-b border-separator px-4 py-3">
                <Modal.Heading className="font-mono text-sm font-medium text-foreground">
                  {table ? `${table}.${column.name}` : column.name}
                </Modal.Heading>
                <span
                  className="rounded px-1 py-[1px] font-mono text-[10px]"
                  style={{
                    color: getTypeColor(column.dataType),
                    background: `color-mix(in oklch, ${getTypeColor(column.dataType)} 12%, transparent)`,
                  }}
                >
                  {column.dataType || "any"}
                </span>
                <div className="flex-1" />
                {isJson && (
                  <Button size="sm" variant="ghost" className="text-xs" isDisabled={!!error} onPress={() => setText(formatJsonForEditor(text))}>
                    Format
                  </Button>
                )}
              </Modal.Header>

              <Modal.Body className="min-h-0 flex-1 p-0">
                <Editor
                  height="100%"
                  language={isJson ? "json" : "plaintext"}
                  value={text}
                  onChange={(next) => setText(next ?? "")}
                  onValidate={(markers) => {
                    const first = markers.find((m) => m.severity === MARKER_ERROR);
                    setMarkerPos(first ? { line: first.startLineNumber, column: first.startColumn } : null);
                  }}
                  theme={theme.isDark ? THEME_DARK : THEME_LIGHT}
                  beforeMount={(monaco) => {
                    buildOrelTheme(monaco, theme.colors, theme.isDark);
                  }}
                  onMount={handleMount}
                  options={{
                    fontSize: 13,
                    lineHeight: 20,
                    fontFamily: "'JetBrains Mono', 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    wordWrap: "on",
                    padding: { top: 10, bottom: 10 },
                    lineNumbersMinChars: 3,
                    glyphMargin: false,
                    folding: isJson,
                    automaticLayout: true,
                    tabSize: 2,
                    scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
                  }}
                />
              </Modal.Body>

              <Modal.Footer className="flex shrink-0 items-center gap-2 border-t border-separator px-4 py-3">
                <div className="min-w-0 flex-1">
                  {error && (
                    <p role="alert" className="flex items-center gap-1.5 truncate text-xs text-danger">
                      <WarningCircleIcon size={13} className="shrink-0" />
                      <span className="truncate">
                        Invalid JSON: {error.message}
                        {line !== undefined && ` (line ${line}, col ${col})`}
                      </span>
                    </p>
                  )}
                </div>
                <Button size="sm" variant="outline" onPress={onCancel}>
                  Cancel
                </Button>
                {column.isNullable && (
                  <Button size="sm" variant="outline" onPress={onSetNull}>
                    Set NULL
                  </Button>
                )}
                <Button size="sm" className="flex items-center gap-1.5" isDisabled={!!error} onPress={apply}>
                  Apply
                  <Kbd className="scale-80">
                    <Kbd.Abbr keyValue={os === "macos" ? "command" : "ctrl"} />
                    <Kbd.Abbr keyValue="enter" />
                  </Kbd>
                </Button>
              </Modal.Footer>
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
