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

export function KeyIcon({ size = 14, strokeWidth = 1.6, className = "", style }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, className, style)}>
      <circle cx="8" cy="15" r="4" />
      <path d="M10.85 12.15L19 4M18 5l3 3M15 8l3 3" />
    </svg>
  );
}
