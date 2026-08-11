import { useEffect, useMemo, useRef, useState } from "react";
import Editor, { type OnMount, type Monaco } from "@monaco-editor/react";
import { Button, Kbd, Spinner, toast } from "@heroui/react";
import {
  CaretDownIcon,
  CaretUpIcon,
  ClockCounterClockwiseIcon,
  DotsThreeIcon,
  GitCommitIcon,
  PlayIcon,
  XIcon,
} from "@phosphor-icons/react";
import { buildOrelTheme, THEME_DARK, THEME_LIGHT } from "../../../lib/monacoTheme";
import { getErrorMessage } from "../../../lib/error";
import { useThemeStore } from "../../../stores/theme.store";
import { THEMES } from "../../../lib/themes";
import {
  useBeginEditorTransaction,
  useCommitEditorTransaction,
  useExecuteEditorSql,
  useDiscardEditorSession,
  useRollbackEditorTransaction,
} from "../../../hooks/useSqlEditor";
import type { SqlEditorState } from "../../../types/editor";
import { EditorResultGrid } from "./EditorResultGrid";
import { usePlatform } from "../../../hooks/dashboard/useDashboardEffects";

export interface SqlEditorCommands {
  closeTab: () => void;
  newQuery: () => void;
  nextTab: () => void;
  prevTab: () => void;
  switchTab: (index: number) => void;
}

interface SqlEditorProps {
  editorId: string;
  connectionId: string;
  sql: string;
  state: SqlEditorState;
  onSqlChange: (sql: string) => void;
  onStateChange: (state: SqlEditorState) => void;
  onDataChanged: () => void;
  commands?: SqlEditorCommands;
}

const MIN_RESULT_HEIGHT = 120;
const DEFAULT_RESULT_HEIGHT = 360;

export function SqlEditor({
  editorId,
  connectionId,
  sql,
  state,
  onSqlChange,
  onStateChange,
  onDataChanged,
  commands,
}: SqlEditorProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const stateRef = useRef(state);
  const onStateChangeRef = useRef(onStateChange);
  const viewStateRef = useRef(state.viewState);
  stateRef.current = state;
  onStateChangeRef.current = onStateChange;
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  const runRef = useRef<() => void>(() => undefined);
  const themeId = useThemeStore((s) => s.themeId);
  const currentTheme = THEMES.find((theme) => theme.id === themeId) ?? THEMES.find((theme) => theme.id === "dark")!;
  const [editorTheme, setEditorTheme] = useState(() => (currentTheme.isDark ? THEME_DARK : THEME_LIGHT));
  const [hasSelection, setHasSelection] = useState(false);
  const [showResult, setShowResult] = useState(state.results.length > 0);
  const [resultHeight, setResultHeight] = useState(DEFAULT_RESULT_HEIGHT);
  const [resultCollapsed, setResultCollapsed] = useState(false);

  const os = usePlatform();

  const executeSql = useExecuteEditorSql();
  const beginTransaction = useBeginEditorTransaction();
  const commitTransaction = useCommitEditorTransaction();
  const rollbackTransaction = useRollbackEditorTransaction();
  const discardSession = useDiscardEditorSession();
  const mountedRef = useRef(true);
  const isBusy =
    state.operationPending ||
    executeSql.isPending ||
    beginTransaction.isPending ||
    commitTransaction.isPending ||
    rollbackTransaction.isPending;

  const dragState = useRef<{ startY: number; startHeight: number } | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      dragCleanupRef.current?.();
    };
  }, []);
  useEffect(
    () => () => {
      const viewState = viewStateRef.current;
      if (!viewState) return;

      onStateChangeRef.current({
        ...stateRef.current,
        viewState,
      });
    },
    [],
  );

  useEffect(() => {
    if (!monacoRef.current) return;
    const theme = THEMES.find((candidate) => candidate.id === themeId);
    if (!theme) return;
    setEditorTheme(buildOrelTheme(monacoRef.current, theme.colors, theme.isDark));
  }, [themeId]);

  const updateState = (patch: Partial<SqlEditorState>) => {
    const nextState = { ...stateRef.current, ...patch };
    stateRef.current = nextState;
    onStateChangeRef.current(nextState);
  };

  const settleUnmountedOperation = async (discardBackendSession: boolean) => {
    if (discardBackendSession) {
      await discardSession.mutateAsync(editorId).catch(() => undefined);
    }
    updateState({
      transactionState: "inactive",
      operationPending: false,
      viewState: viewStateRef.current ?? stateRef.current.viewState,
    });
  };

  const handleOperationError = async (error: unknown, fallbackMessage: string) => {
    if (!mountedRef.current) {
      await settleUnmountedOperation(true);
      return;
    }
    updateState({ operationPending: false });
    toast.danger(getErrorMessage(error, fallbackMessage));
  };

  const setMode = (mode: SqlEditorState["mode"]) => {
    if (stateRef.current.mode !== mode) updateState({ mode });
  };

  const selectedSql = () => {
    const editor = editorRef.current;
    const selection = editor?.getSelection();
    const model = editor?.getModel();
    if (selection && model && !selection.isEmpty()) {
      const selected = model.getValueInRange(selection);
      if (selected.trim()) return selected;
    }
    return sql;
  };

  const handleRun = () => {
    const query = selectedSql();
    if (!query.trim() || isBusy) return;
    updateState({ operationPending: true });
    void executeSql
      .mutateAsync({ connectionId, editorId, sql: query, mode: stateRef.current.mode })
      .then(async (response) => {
        if (!mountedRef.current) {
          await settleUnmountedOperation(response.transactionState !== "inactive");
          return;
        }
        const errorIndex = response.results.findIndex((result) => result.kind === "error");
        updateState({
          mode: response.forceManual ? "manual" : stateRef.current.mode,
          transactionState: response.transactionState,
          operationPending: false,
          results: response.results,
          activeResultIndex: errorIndex >= 0 ? errorIndex : 0,
        });
        setShowResult(true);
        setResultCollapsed(false);
        const failed = response.results.find((result) => result.error)?.error;
        if (failed) toast.danger(failed.message);
        if (response.transactionState === "inactive" && response.results.some((result) => result.kind === "affected")) {
          onDataChanged();
        }
      })
      .catch((error: unknown) => handleOperationError(error, "Failed to execute SQL"));
  };
  runRef.current = handleRun;

  const handleMount: OnMount = (editorInstance, monaco) => {
    editorRef.current = editorInstance;
    monacoRef.current = monaco;
    setEditorTheme(buildOrelTheme(monaco, currentTheme.colors, currentTheme.isDark));
    const captureViewState = () => {
      const selection = editorInstance.getSelection();
      if (!selection) return;
      viewStateRef.current = {
        selectionStartLineNumber: selection.selectionStartLineNumber,
        selectionStartColumn: selection.selectionStartColumn,
        positionLineNumber: selection.positionLineNumber,
        positionColumn: selection.positionColumn,
        scrollTop: editorInstance.getScrollTop(),
        scrollLeft: editorInstance.getScrollLeft(),
      };
    };
    const savedViewState = stateRef.current.viewState;
    if (savedViewState) {
      editorInstance.setSelection(savedViewState);
      editorInstance.setScrollPosition({
        scrollTop: savedViewState.scrollTop,
        scrollLeft: savedViewState.scrollLeft,
      });
      const restoredSelection = editorInstance.getSelection();
      const selected = restoredSelection ? (editorInstance.getModel()?.getValueInRange(restoredSelection) ?? "") : "";
      setHasSelection(selected.trim().length > 0);
    }
    captureViewState();
    editorInstance.onDidChangeCursorSelection(() => {
      const selection = editorInstance.getSelection();
      const selected = selection ? (editorInstance.getModel()?.getValueInRange(selection) ?? "") : "";
      setHasSelection(selected.trim().length > 0);
      captureViewState();
    });
    editorInstance.onDidScrollChange(captureViewState);
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current());
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => commandsRef.current?.closeTab());
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyT, () => commandsRef.current?.newQuery());
    editorInstance.addCommand(monaco.KeyMod.WinCtrl | monaco.KeyCode.Tab, () => commandsRef.current?.nextTab());
    editorInstance.addCommand(monaco.KeyMod.WinCtrl | monaco.KeyMod.Shift | monaco.KeyCode.Tab, () =>
      commandsRef.current?.prevTab(),
    );
    ([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).forEach((number) => {
      editorInstance.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode[`Digit${number}` as keyof typeof monaco.KeyCode],
        () => commandsRef.current?.switchTab(number - 1),
      );
    });
    editorInstance.focus();
  };

  const handleBegin = () => {
    if (isBusy) return;
    updateState({ operationPending: true });
    void beginTransaction
      .mutateAsync({ connectionId, editorId })
      .then(async (transactionState) => {
        if (!mountedRef.current) {
          await settleUnmountedOperation(true);
          return;
        }
        updateState({ transactionState, operationPending: false });
        toast.success("Transaction started");
      })
      .catch((error: unknown) => handleOperationError(error, "Failed to begin transaction"));
  };

  const completeTransaction = (action: "commit" | "rollback") => {
    if (isBusy) return;
    const mutation = action === "commit" ? commitTransaction : rollbackTransaction;
    updateState({ operationPending: true });
    void mutation
      .mutateAsync(editorId)
      .then(async () => {
        if (!mountedRef.current) {
          await settleUnmountedOperation(false);
          return;
        }
        updateState({ transactionState: "inactive", operationPending: false });
        toast.success(action === "commit" ? "Transaction committed" : "Transaction rolled back");
        if (action === "commit") onDataChanged();
      })
      .catch((error: unknown) => handleOperationError(error, `Failed to ${action} transaction`));
  };

  const activeResult = state.results[state.activeResultIndex] ?? state.results[0] ?? null;
  const lineCount = useMemo(() => (sql.match(/\n/g) ?? []).length + 1, [sql]);

  const handleDragStart = (event: React.MouseEvent) => {
    event.preventDefault();
    dragState.current = { startY: event.clientY, startHeight: resultHeight };
    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!dragState.current) return;
      setResultHeight(
        Math.max(MIN_RESULT_HEIGHT, dragState.current.startHeight + dragState.current.startY - moveEvent.clientY),
      );
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

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="min-h-12 px-3.5 py-2 flex flex-wrap items-center gap-2 border-b border-separator bg-surface shrink-0">
        <Button
          size="sm"
          className="flex items-center gap-1.5 text-xs"
          onClick={handleRun}
          isDisabled={!sql.trim() || isBusy}
        >
          {executeSql.isPending ? <Spinner size="sm" /> : <PlayIcon className="size-2" weight="fill" />}
          {hasSelection ? "Run Selection" : "Run All"}
          <Kbd className="scale-80">
            <Kbd.Abbr keyValue={os === "macos" ? "command" : "ctrl"} />
            <Kbd.Abbr keyValue="enter" />
          </Kbd>
        </Button>

        {state.transactionState === "inactive" ? (
          <div key="transaction-inactive" className="transaction-controls-enter flex items-center">
            <div className="flex rounded-lg border border-separator bg-surface-secondary p-0.5">
              <button
                onClick={() => setMode("autoCommit")}
                className={`rounded-md px-2.5 py-1 text-xs ${state.mode === "autoCommit" ? "bg-surface text-foreground shadow-sm" : "text-muted"}`}
              >
                Auto Commit
              </button>
              <button
                onClick={() => setMode("manual")}
                className={`rounded-md px-2.5 py-1 text-xs ${state.mode === "manual" ? "bg-surface text-foreground shadow-sm" : "text-muted"}`}
              >
                Manual
              </button>
            </div>
            <div
              className="transaction-begin-slot"
              data-visible={state.mode === "manual"}
              aria-hidden={state.mode !== "manual"}
            >
              <div className="min-w-0 overflow-hidden">
                <div className="flex rounded-lg border border-separator bg-surface-secondary p-0.5">
                  <button
                    onClick={handleBegin}
                    disabled={state.mode !== "manual" || isBusy}
                    tabIndex={state.mode === "manual" ? 0 : -1}
                    className="whitespace-nowrap rounded-md bg-surface px-2.5 py-1 text-xs text-foreground shadow-sm transition-colors hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Begin
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div
            key={`transaction-${state.transactionState}`}
            className="transaction-controls-enter flex items-center gap-2"
          >
            <div
              className={`transaction-status-control flex rounded-lg border p-0.5 ${state.transactionState === "failed" ? "transaction-status-control-failed" : "transaction-status-control-active"}`}
            >
              <span className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold">
                <GitCommitIcon size={14} weight="bold" />
                {state.transactionState === "failed" ? "Transaction failed — rollback required" : "Transaction active"}
              </span>
            </div>
            <div className="flex rounded-lg border border-separator bg-surface-secondary p-0.5">
              <button
                onClick={() => completeTransaction("commit")}
                disabled={state.transactionState !== "active" || isBusy}
                className="rounded-md px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-surface hover:text-success disabled:cursor-not-allowed disabled:opacity-40"
              >
                Commit
              </button>
              <button
                onClick={() => completeTransaction("rollback")}
                disabled={isBusy}
                className="rounded-md px-2.5 py-1 text-xs text-danger transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
              >
                Rollback
              </button>
            </div>
          </div>
        )}

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
            scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
          }}
        />
      </div>

      {showResult && activeResult && (
        <div className="flex flex-col shrink-0 border-t border-separator bg-surface">
          <div onMouseDown={handleDragStart} className="h-1 w-full cursor-row-resize shrink-0 group">
            <div className="h-px w-full bg-separator transition-colors group-hover:bg-accent" />
          </div>
          <div className="flex items-center gap-1 px-3.5 h-9 border-b border-separator shrink-0 overflow-x-auto scrollbar-hide">
            {state.results.map((result, index) => (
              <button
                key={`${result.index}-${index}`}
                onClick={() => updateState({ activeResultIndex: index })}
                className={`shrink-0 rounded-md px-2.5 py-1 font-mono text-xs ${state.activeResultIndex === index ? "bg-surface-secondary text-foreground" : "text-muted"}`}
              >
                Result {result.index}
                {result.kind === "error" ? " · Error" : ""}
              </button>
            ))}
            <div className="flex-1" />
            <span className="shrink-0 font-mono text-[11px] text-muted">
              {activeResult.kind === "error"
                ? "Error"
                : activeResult.kind === "rows"
                  ? `${activeResult.rowCount} rows`
                  : `${activeResult.rowsAffected} affected`}{" "}
              · {activeResult.elapsedMs}ms
              {activeResult.truncated ? ` · showing first ${activeResult.rowLimit}` : ""}
            </span>
            <Button
              size="sm"
              variant="ghost"
              isIconOnly
              aria-label={resultCollapsed ? "Expand results" : "Collapse results"}
              onClick={() => setResultCollapsed((value) => !value)}
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
          {!resultCollapsed && (
            <div className="bg-background" style={{ height: resultHeight }}>
              <EditorResultGrid result={activeResult} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
