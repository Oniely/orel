import { useEffect, useMemo, useRef, useState } from "react";
import Editor, { type OnMount, type Monaco } from "@monaco-editor/react";
import { Button } from "@heroui/react";
import {
  PlayIcon,
  ClockCounterClockwiseIcon,
  DotsThreeIcon,
  XIcon,
  CaretUpIcon,
  CaretDownIcon,
} from "@phosphor-icons/react";
import { buildOrelTheme, THEME_DARK, THEME_LIGHT } from "../../lib/monacoTheme";
import { useThemeStore } from "../../stores/theme.store";
import { THEMES } from "../../lib/themes";

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


export function SqlEditor({ sql, onSqlChange, commands }: SqlEditorProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  const themeId = useThemeStore((s) => s.themeId);
  const currentTheme = THEMES.find((t) => t.id === themeId) ?? THEMES.find((t) => t.id === "dark")!;
  const [editorTheme, setEditorTheme] = useState(() => currentTheme.isDark ? THEME_DARK : THEME_LIGHT);
  const [showResult, setShowResult] = useState(false);
  const [resultHeight, setResultHeight] = useState(DEFAULT_RESULT_HEIGHT);
  const [resultCollapsed, setResultCollapsed] = useState(false);

  const dragState = useRef<{ startY: number; startHeight: number } | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => { dragCleanupRef.current?.(); }, []);

  // Re-register Monaco theme when the app theme changes via store
  useEffect(() => {
    if (!monacoRef.current) return;
    const theme = THEMES.find((t) => t.id === themeId);
    if (!theme) return;
    const name = buildOrelTheme(monacoRef.current, theme.colors, theme.isDark);
    setEditorTheme(name);
  }, [themeId]);

  const handleMount: OnMount = (editorInstance, monaco: Monaco) => {
    editorRef.current = editorInstance;
    monacoRef.current = monaco;
    // Re-apply theme on mount to guarantee correct colors
    const name = buildOrelTheme(monaco, currentTheme.colors, currentTheme.isDark);
    setEditorTheme(name);
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
            className="text-[11px] px-1 py-[1px] rounded-xs ml-0.5"
            style={{ opacity: 0.7, background: "color-mix(in oklch, var(--accent-foreground) 18%, transparent)" }}
          >
            ⌘↵
          </span>
        </Button>

        <div className="flex-1" />

        <span className="text-xs font-mono text-muted">
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
          theme={editorTheme}
          beforeMount={(monaco) => {
            buildOrelTheme(monaco, currentTheme.colors, currentTheme.isDark);
          }}
          onMount={handleMount}
          options={{
            fontSize: 13,
            lineHeight: 20,
            fontFamily: "'JetBrains Mono', 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
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
            <span className="flex items-center gap-1.5 font-mono text-xs text-muted">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--success)" }} />
              Query OK
            </span>
            <span className="text-xs font-mono text-muted">·</span>
            <span className="text-xs font-mono text-muted">
              <span className="text-foreground">12</span> rows in <span className="text-foreground">34ms</span>
            </span>
            <span className="text-xs font-mono text-muted">·</span>
            <span className="text-xs font-mono text-muted">
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
              <div className="flex items-center justify-center h-full text-sm text-muted">
                Results will appear here
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
