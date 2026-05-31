import { useEffect, useMemo, useRef, useState } from "react";
import Editor, { type OnMount, type Monaco, type BeforeMount } from "@monaco-editor/react";
import { Button } from "@heroui/react";
import {
  PlayIcon,
  ClockCounterClockwiseIcon,
  DotsThreeIcon,
  XIcon,
  CaretUpIcon,
  CaretDownIcon,
} from "@phosphor-icons/react";

export interface SqlEditorCommands {
  closeTab: () => void;
  newQuery: () => void;
  nextTab: () => void;
  prevTab: () => void;
  switchTab: (index: number) => void;
}

interface SqlEditorProps {
  sql: string;
  onSqlChange: (sql: string) => void;
  commands?: SqlEditorCommands;
}

const MIN_RESULT_HEIGHT = 80;
const DEFAULT_RESULT_HEIGHT = 200;

// ── Custom Monaco theme derived from the app's OKLCH design tokens ─────────────
// All hex values computed from the exact oklch() values in global.css.
//
// Palette reference:
//   surface          #151822   editor canvas
//   surface-secondary #21232b  gutter, widgets
//   separator        #202127   borders
//   accent           #5865f2   cursor, selection, keywords
//   muted            #9c9fad
//   foreground       #fafcff

const defineOrelTheme: BeforeMount = (monaco) => {
  monaco.editor.defineTheme("orel-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "c0c3d1" }, // default text
      { token: "keyword", foreground: "7f93ff", fontStyle: "bold" }, // SQL keywords
      { token: "keyword.sql", foreground: "7f93ff", fontStyle: "bold" },
      { token: "string", foreground: "f28979" }, // strings
      { token: "string.sql", foreground: "f28979" },
      { token: "number", foreground: "c9b957" }, // numbers
      { token: "number.sql", foreground: "c9b957" },
      { token: "comment", foreground: "464c63", fontStyle: "italic" },
      { token: "comment.sql", foreground: "464c63", fontStyle: "italic" },
      { token: "operator.sql", foreground: "808599" }, // = > < etc.
      { token: "predefined.sql", foreground: "a497ea" }, // COUNT, MAX …
      { token: "identifier.sql", foreground: "c0c3d1" },
      { token: "delimiter", foreground: "808599" },
      { token: "delimiter.sql", foreground: "808599" },
    ],
    colors: {
      // Canvas
      "editor.background": "#151822",
      "editor.foreground": "#c0c3d1",
      // Gutter
      "editorGutter.background": "#131120",
      "editorLineNumber.foreground": "#2b2d36",
      "editorLineNumber.activeForeground": "#6a7089",
      // Cursor & selection
      "editorCursor.foreground": "#5865f2",
      "editor.selectionBackground": "#2b2d5c",
      "editor.inactiveSelectionBackground": "#202040",
      // Line highlight
      "editor.lineHighlightBackground": "#1c1b2a",
      "editor.lineHighlightBorder": "#00000000",
      // Indent guides
      "editorIndentGuide.background": "#202127",
      "editorIndentGuide.activeBackground": "#3c3c58",
      // Widgets (autocomplete, hover)
      "editorWidget.background": "#21232b",
      "editorWidget.border": "#202127",
      "editorSuggestWidget.background": "#21232b",
      "editorSuggestWidget.border": "#202127",
      "editorSuggestWidget.selectedBackground": "#2b2d5c",
      "editorSuggestWidget.selectedForeground": "#c0c3d1",
      "editorHoverWidget.background": "#21232b",
      "editorHoverWidget.border": "#202127",
      // Scrollbar
      "scrollbar.shadow": "#00000000",
      "scrollbarSlider.background": "#3a385840",
      "scrollbarSlider.hoverBackground": "#5865f240",
      "scrollbarSlider.activeBackground": "#5865f260",
      // Misc
      focusBorder: "#5865f2",
      "input.background": "#21232b",
      "input.border": "#202127",
    },
  });
};

export function SqlEditor({ sql, onSqlChange, commands }: SqlEditorProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  const [showResult, setShowResult] = useState(false);
  const [resultHeight, setResultHeight] = useState(DEFAULT_RESULT_HEIGHT);
  const [resultCollapsed, setResultCollapsed] = useState(false);

  const dragState = useRef<{ startY: number; startHeight: number } | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => { dragCleanupRef.current?.(); }, []);

  const handleMount: OnMount = (editorInstance, monaco: Monaco) => {
    editorRef.current = editorInstance;
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, handleRun);
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => commandsRef.current?.closeTab());
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyT, () => commandsRef.current?.newQuery());
    editorInstance.addCommand(monaco.KeyMod.WinCtrl | monaco.KeyCode.Tab, () => commandsRef.current?.nextTab());
    editorInstance.addCommand(monaco.KeyMod.WinCtrl | monaco.KeyMod.Shift | monaco.KeyCode.Tab, () => commandsRef.current?.prevTab());
    ([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).forEach((n) => {
      editorInstance.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode[`Digit${n}` as keyof typeof monaco.KeyCode],
        () => commandsRef.current?.switchTab(n - 1),
      );
    });
    editorInstance.focus();
  };

  const handleRun = () => {
    // TODO: wire to actual query execution
    setShowResult(true);
    setResultCollapsed(false);
  };

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragState.current = { startY: e.clientY, startHeight: resultHeight };

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragState.current) return;
      const delta = dragState.current.startY - ev.clientY;
      setResultHeight(Math.max(MIN_RESULT_HEIGHT, dragState.current.startHeight + delta));
    };

    const onMouseUp = () => {
      dragState.current = null;
      dragCleanupRef.current = null;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    dragCleanupRef.current = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const lineCount = useMemo(() => (sql.match(/\n/g) ?? []).length + 1, [sql]);
  const effectiveResultHeight = resultCollapsed ? 0 : resultHeight;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="h-12 px-3.5 flex items-center gap-2 border-b border-separator bg-surface shrink-0">
        <Button size="sm" className="flex items-center gap-1.5 text-xs" onClick={handleRun}>
          <PlayIcon className="size-2" weight="fill" />
          Run
          <span
            className="text-[9px] px-1 py-[1px] rounded-xs ml-0.5"
            style={{ opacity: 0.7, background: "rgba(255,255,255,0.18)" }}
          >
            ⌘↵
          </span>
        </Button>

        <div className="flex-1" />

        <span className="text-[11px] font-mono text-default-400">
          {sql.length} chars · {lineCount} lines
        </span>

        <div className="w-px h-3.5 shrink-0 bg-separator" />

        <Button size="sm" variant="ghost" isIconOnly aria-label="History">
          <ClockCounterClockwiseIcon size={13} />
        </Button>

        <Button size="sm" variant="ghost" isIconOnly aria-label="More">
          <DotsThreeIcon size={15} />
        </Button>
      </div>

      {/* Monaco editor — fills remaining space */}
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          language="sql"
          value={sql}
          onChange={(value) => onSqlChange(value ?? "")}
          theme="orel-dark"
          beforeMount={defineOrelTheme}
          onMount={handleMount}
          options={{
            fontSize: 13,
            lineHeight: 20,
            fontFamily: "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
            fontLigatures: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: "off",
            padding: { top: 10, bottom: 10 },
            renderLineHighlight: "line",
            lineNumbersMinChars: 3,
            glyphMargin: false,
            folding: false,
            automaticLayout: true,
            tabSize: 2,
            scrollbar: {
              verticalScrollbarSize: 6,
              horizontalScrollbarSize: 6,
            },
          }}
        />
      </div>

      {/* Result panel — hidden until first run */}
      {showResult && (
        <div className="flex flex-col shrink-0 border-t border-separator bg-surface">
          {/* Drag handle */}
          <div
            onMouseDown={handleDragStart}
            className="h-1 w-full cursor-row-resize shrink-0 group"
            style={{ background: "transparent" }}
          >
            <div
              className="h-px w-full transition-colors group-hover:bg-accent"
              style={{ background: "var(--separator)" }}
            />
          </div>

          {/* Result header */}
          <div className="flex items-center gap-2 px-3.5 h-8 border-b border-separator shrink-0">
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-default-400">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "oklch(73% 0.18 153)" }} />
              Query OK
            </span>
            <span className="text-[11px] font-mono text-default-400">·</span>
            <span className="text-[11px] font-mono text-default-400">
              <span className="text-foreground">12</span> rows in <span className="text-foreground">34ms</span>
            </span>
            <span className="text-[11px] font-mono text-default-400">·</span>
            <span className="text-[11px] font-mono text-default-400">
              <span className="text-foreground">5</span> columns
            </span>

            <div className="flex-1" />

            <Button
              size="sm"
              variant="ghost"
              isIconOnly
              aria-label={resultCollapsed ? "Expand results" : "Collapse results"}
              onClick={() => setResultCollapsed((v) => !v)}
            >
              {resultCollapsed ? <CaretUpIcon size={12} /> : <CaretDownIcon size={12} />}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              isIconOnly
              aria-label="Close results"
              onClick={() => setShowResult(false)}
            >
              <XIcon size={12} />
            </Button>
          </div>

          {/* Result content */}
          {!resultCollapsed && (
            <div className="overflow-auto bg-background" style={{ height: effectiveResultHeight }}>
              <div className="flex items-center justify-center h-full text-sm text-default-400">
                Results will appear here
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
