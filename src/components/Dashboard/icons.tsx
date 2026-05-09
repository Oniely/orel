interface IconProps {
  className?: string;
  style?: React.CSSProperties;
  size?: number;
  strokeWidth?: number;
}

const base = (size: number, sw: number, className = "", style?: React.CSSProperties) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24" as const,
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: sw,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className,
  style,
});

export function SearchIcon({ size = 14, strokeWidth = 1.6, className = "", style }: IconProps) {
  return <svg {...base(size, strokeWidth, className, style)}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>;
}

export function XIcon({ size = 14, strokeWidth = 1.6, className = "", style }: IconProps) {
  return <svg {...base(size, strokeWidth, className, style)}><path d="M18 6L6 18M6 6l12 12" /></svg>;
}

export function PlusIcon({ size = 14, strokeWidth = 1.6, className = "", style }: IconProps) {
  return <svg {...base(size, strokeWidth, className, style)}><path d="M12 5v14M5 12h14" /></svg>;
}

export function ChevronDownIcon({ size = 14, strokeWidth = 1.6, className = "", style }: IconProps) {
  return <svg {...base(size, strokeWidth, className, style)}><path d="M6 9l6 6 6-6" /></svg>;
}

export function ChevronLeftIcon({ size = 14, strokeWidth = 1.6, className = "", style }: IconProps) {
  return <svg {...base(size, strokeWidth, className, style)}><path d="M15 6l-6 6 6 6" /></svg>;
}

export function ChevronRightIcon({ size = 14, strokeWidth = 1.6, className = "", style }: IconProps) {
  return <svg {...base(size, strokeWidth, className, style)}><path d="M9 6l6 6-6 6" /></svg>;
}

export function TableIcon({ size = 14, strokeWidth = 1.6, className = "", style }: IconProps) {
  return <svg {...base(size, strokeWidth, className, style)}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" /></svg>;
}

export function ViewIcon({ size = 14, strokeWidth = 1.6, className = "", style }: IconProps) {
  return <svg {...base(size, strokeWidth, className, style)}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>;
}

export function KeyIcon({ size = 14, strokeWidth = 1.6, className = "", style }: IconProps) {
  return <svg {...base(size, strokeWidth, className, style)}><circle cx="8" cy="15" r="4" /><path d="M10.85 12.15L19 4M18 5l3 3M15 8l3 3" /></svg>;
}

export function RefreshIcon({ size = 14, strokeWidth = 1.6, className = "", style }: IconProps) {
  return <svg {...base(size, strokeWidth, className, style)}><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>;
}

export function DownloadIcon({ size = 14, strokeWidth = 1.6, className = "", style }: IconProps) {
  return <svg {...base(size, strokeWidth, className, style)}><path d="M12 4v12M6 12l6 6 6-6M4 20h16" /></svg>;
}

export function DatabaseIcon({ size = 14, strokeWidth = 1.6, className = "", style }: IconProps) {
  return <svg {...base(size, strokeWidth, className, style)}><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14a9 3 0 0 0 18 0V5" /><path d="M3 12a9 3 0 0 0 18 0" /></svg>;
}

export function CopyIcon({ size = 14, strokeWidth = 1.6, className = "", style }: IconProps) {
  return <svg {...base(size, strokeWidth, className, style)}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>;
}

export function TrashIcon({ size = 14, strokeWidth = 1.6, className = "", style }: IconProps) {
  return <svg {...base(size, strokeWidth, className, style)}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>;
}

export function JsonIcon({ size = 14, strokeWidth = 1.6, className = "", style }: IconProps) {
  return <svg {...base(size, strokeWidth, className, style)}><path d="M9 4H7a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h2" /><path d="M15 4h2a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v3a2 2 0 0 1-2 2h-2" /></svg>;
}

export function PanelRightIcon({ size = 14, strokeWidth = 1.6, className = "", style }: IconProps) {
  return <svg {...base(size, strokeWidth, className, style)}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M15 3v18" /></svg>;
}

export function CodeIcon({ size = 14, strokeWidth = 1.6, className = "", style }: IconProps) {
  return <svg {...base(size, strokeWidth, className, style)}><path d="M16 18l6-6-6-6M8 6l-6 6 6 6" /></svg>;
}
