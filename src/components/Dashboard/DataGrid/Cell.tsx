import { getTypeColor } from "../../../lib/typeColors";

// Only http(s) links whose path ends in an image extension get a thumbnail
const IMAGE_URL = /^https?:\/\/[^\s?#]+\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)([?#]\S*)?$/i;

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
  if (typeof value === "string" && IMAGE_URL.test(value)) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <img
          src={value}
          className="w-4 h-4 shrink-0 rounded-sm object-cover"
          alt=""
          onError={(e) => (e.currentTarget.style.display = "none")}
        />
        <span className="font-mono text-xs" style={{ color }}>
          {value}
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
