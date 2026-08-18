import type { SqlCell } from "../../../types/editor";
import { getTypeColor } from "../../../lib/typeColors";

export default function Cell({ cell, type }: { cell: SqlCell; type: string }) {
  if (cell.kind === "null" || cell.display === null) {
    return <span className="text-muted italic text-xs">NULL</span>;
  }
  const color = getTypeColor(type);
  if (cell.kind === "boolean") {
    const bool = cell.display === "true";
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-[2px]" style={{ background: bool ? "var(--success)" : "var(--muted)" }} />
        <span className="font-mono text-xs" style={{ color }}>
          {bool ? "true" : "false"}
        </span>
      </span>
    );
  }
  if (cell.kind === "text" && cell.display.startsWith("http")) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <img src={cell.display} className="w-4 h-4 rounded-full object-cover" alt="" />
        <span className="font-mono text-xs truncate" style={{ color }}>
          {cell.display.slice(0, 32)}…
        </span>
      </span>
    );
  }
  return (
    <span className="font-mono text-xs" style={{ color }}>
      {cell.display}
    </span>
  );
}
