import { useEffect, useRef, useState } from "react";
import Editor, { type Monaco } from "@monaco-editor/react";
import { Button, Spinner, toast } from "@heroui/react";
import { CheckIcon, CopyIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { getErrorMessage } from "../../../lib/error";
import { buildOrelTheme, THEME_DARK, THEME_LIGHT } from "../../../lib/monacoTheme";
import { THEMES } from "../../../lib/themes";
import { useThemeStore } from "../../../stores/theme.store";
import { useFetchTableDdl } from "../../../hooks/useTables";

interface DDLProps {
  connectionId: string | null;
  database: string | null;
  table: string | null;
}

function sourceLabel(source: "native" | "generated"): string {
  return source === "native" ? "Native DDL" : "Generated DDL";
}

export function DDL({ connectionId, database, table }: DDLProps) {
  const { data, isLoading, isError, error } = useFetchTableDdl(connectionId, database, table);
  const monacoRef = useRef<Monaco | null>(null);
  const themeId = useThemeStore((s) => s.themeId);
  const currentTheme = THEMES.find((theme) => theme.id === themeId) ?? THEMES.find((theme) => theme.id === "dark")!;
  const [editorTheme, setEditorTheme] = useState(() => (currentTheme.isDark ? THEME_DARK : THEME_LIGHT));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!monacoRef.current) return;
    setEditorTheme(buildOrelTheme(monacoRef.current, currentTheme.colors, currentTheme.isDark));
  }, [currentTheme]);

  useEffect(() => {
    setCopied(false);
  }, [data?.ddl]);

  const handleTheme = (monaco: Monaco) => {
    monacoRef.current = monaco;
    setEditorTheme(buildOrelTheme(monaco, currentTheme.colors, currentTheme.isDark));
  };

  const handleCopy = async () => {
    if (!data?.ddl) return;

    try {
      await navigator.clipboard.writeText(data.ddl);
      setCopied(true);
      toast.success("DDL copied");
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.danger("Failed to copy DDL");
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="sm" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="flex max-w-md items-center gap-2 rounded-md border border-separator bg-surface px-3 py-2 text-sm text-muted">
          <WarningCircleIcon className="size-4 shrink-0 text-warning" />
          <span>{getErrorMessage(error, "Failed to load DDL")}</span>
        </div>
      </div>
    );
  }

  if (!data?.ddl) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted">No DDL available</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-separator bg-surface px-4.5">
        <span className="font-mono text-[11px] uppercase text-muted">{sourceLabel(data.source)}</span>
        <span className="font-mono text-[11px] text-muted">· {data.dialect}</span>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          isIconOnly
          aria-label="Copy DDL"
          className="size-6.5 grid place-items-center p-[0.5]"
          onClick={handleCopy}
        >
          {copied ? <CheckIcon className="size-3 text-success" /> : <CopyIcon className="size-3" />}
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          language="sql"
          value={data.ddl}
          theme={editorTheme}
          beforeMount={handleTheme}
          options={{
            readOnly: true,
            domReadOnly: true,
            fontSize: 13,
            lineHeight: 20,
            fontFamily: "'JetBrains Mono', 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
            fontLigatures: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: "off",
            padding: { top: 12, bottom: 12 },
            renderLineHighlight: "none",
            lineNumbersMinChars: 3,
            glyphMargin: false,
            folding: false,
            automaticLayout: true,
            tabSize: 2,
            scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
            contextmenu: false,
            overviewRulerLanes: 0,
          }}
        />
      </div>
    </div>
  );
}
