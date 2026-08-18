import { CheckIcon } from "@phosphor-icons/react";
import type { StatementResult } from "../../../types/editor";
import Cell from "../DataGrid/Cell";
import { KeyIcon } from "../shared/icons";
import { getTypeColor } from "../../../lib/typeColors";

export function EditorResultGrid({ result }: { result: StatementResult }) {
  if (result.kind === "error" && result.error) {
    return (
      <div className="h-full overflow-auto p-5">
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-4 font-mono text-xs">
          <p className="font-semibold text-danger">Statement {result.index} failed</p>
          {result.error.code && <p className="mt-2 text-muted">Code: {result.error.code}</p>}
          <pre className="mt-2 whitespace-pre-wrap text-foreground">{result.error.message}</pre>
          {result.message && <p className="mt-3 text-warning">{result.message}</p>}
        </div>
      </div>
    );
  }

  if (result.kind === "message") {
    return <div className="grid h-full place-items-center text-sm text-muted">{result.message}</div>;
  }

  if (result.kind === "affected") {
    return (
      <div className="grid h-full place-items-center">
        <div className="rounded-lg border border-separator bg-surface px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <CheckIcon className="text-success" size={16} weight="bold" />
            <span>
              Query completed · <strong>{result.rowsAffected}</strong> row{result.rowsAffected === 1 ? "" : "s"}{" "}
              affected
            </span>
          </div>
          {result.message && <p className="mt-2 text-xs text-warning">{result.message}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-background">
      {result.message && (
        <div className="sticky left-0 top-0 z-[2] border-b border-warning/30 bg-warning/10 px-3.5 py-2 text-xs text-warning">
          {result.message}
        </div>
      )}
      <table
        className="min-w-full border-collapse table-fixed text-xs"
        style={{ width: Math.max(640, 52 + result.columns.length * 210) }}
      >
        <colgroup>
          <col style={{ width: 52 }} />
          {result.columns.map((_, index) => (
            <col key={index} style={{ width: 210 }} />
          ))}
        </colgroup>
        <thead>
          <tr className="sticky top-0 z-[1] bg-background">
            <th className="w-[52px] border-b-hairline px-3.5 py-2.5" />
            {result.columns.map((column, index) => (
              <th
                key={`${column.name}-${index}`}
                className="border-b-hairline px-3.5 py-2.5 text-left text-xs font-medium whitespace-nowrap overflow-hidden"
              >
                <div className="flex items-center gap-1.5 overflow-hidden">
                  {column.isPrimary && <KeyIcon size={9} className="text-warning shrink-0" />}
                  <span className="font-mono text-foreground shrink-0">{column.name}</span>
                  <span
                    className="min-w-0 truncate rounded px-1 py-px font-mono text-[10px]"
                    style={{
                      color: getTypeColor(column.dataType),
                      background: `color-mix(in oklch, ${getTypeColor(column.dataType)} 12%, transparent)`,
                    }}
                  >
                    {column.dataType.toLowerCase() || "any"}
                  </span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="h-10">
              <td className="border-b-hairline px-3.5 font-mono text-xs text-muted select-none">{rowIndex + 1}</td>
              {result.columns.map((column, columnIndex) => {
                const value = row[columnIndex] ?? { kind: "null" as const, display: null };
                return (
                  <td key={columnIndex} className="border-b-hairline overflow-hidden whitespace-nowrap px-3.5">
                    <div className="truncate">
                      <Cell cell={value} type={column.dataType} />
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
          {result.rows.length === 0 && (
            <tr>
              <td colSpan={Math.max(1, result.columns.length + 1)} className="py-12 text-center text-muted">
                No rows
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
