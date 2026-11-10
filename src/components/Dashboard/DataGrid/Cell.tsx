import { getTypeColor } from "../../../lib/typeColors";

export default function Cell({ value, type }: { value: unknown; type: string }) {
  if (value === null || value === undefined) {
    return <span className="text-muted italic text-xs">NULL</span>;
  }
  const color = getTypeColor(type);
  const isBool = type === "boolean";
  if (typeof value === "boolean" || (isBool && (value === "true" || value === "false"))) {
    const bool = value === true || value === "true";
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-[2px]" style={{ background: bool ? "var(--success)" : "var(--muted)" }} />
        <span className="font-mono text-xs" style={{ color }}>
          {bool ? "true" : "false"}
        </span>
      </span>
    );
  }
  const display = typeof value === "object" ? JSON.stringify(value) : String(value);
  return (
    <span className="font-mono text-xs" style={{ color }}>
      {display}
    </span>
  );
}
