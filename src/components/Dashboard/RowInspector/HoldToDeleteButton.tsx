import { useCallback, useEffect, useRef, useState } from "react";
import { Tooltip } from "@heroui/react";
import { TrashIcon } from "@phosphor-icons/react";

const HOLD_DURATION = 800;
const CANCEL_DURATION = 300;
const TILE_ORDER = [4, 0, 8, 2, 6, 1, 7, 3, 5];

type Phase = "idle" | "holding" | "canceling" | "deleting";

interface HoldToDeleteButtonProps {
  onDelete: () => Promise<void>;
  isDisabled: boolean;
}

export function HoldToDeleteButton({ onDelete, isDisabled }: HoldToDeleteButtonProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const rafRef = useRef(0);
  const startRef = useRef(0);
  const cancelStartRef = useRef(0);
  const cancelFromRef = useRef(0);
  const phaseRef = useRef<Phase>("idle");

  // Keep phaseRef in sync so RAF callbacks read the latest value
  phaseRef.current = phase;

  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const holdTick = useCallback(() => {
    if (phaseRef.current !== "holding") return;
    const p = Math.min(1, (performance.now() - startRef.current) / HOLD_DURATION);
    setProgress(p);
    if (p < 1) rafRef.current = requestAnimationFrame(holdTick);
  }, []);

  const cancelTick = useCallback(() => {
    if (phaseRef.current !== "canceling") return;
    const t = (performance.now() - cancelStartRef.current) / CANCEL_DURATION;
    const p = Math.max(0, cancelFromRef.current * (1 - t));
    if (p <= 0) {
      setPhase("idle");
      setProgress(0);
      return;
    }
    setProgress(p);
    rafRef.current = requestAnimationFrame(cancelTick);
  }, []);

  const onDown = (e: React.PointerEvent) => {
    if (isDisabled || phase === "deleting") return;
    e.preventDefault();
    cancelAnimationFrame(rafRef.current);
    startRef.current = performance.now() - progress * HOLD_DURATION;
    setPhase("holding");
    phaseRef.current = "holding";
    rafRef.current = requestAnimationFrame(holdTick);
  };

  const cancelHold = () => {
    if (phaseRef.current !== "holding") return;
    cancelAnimationFrame(rafRef.current);
    cancelStartRef.current = performance.now();
    cancelFromRef.current = progress;
    setPhase("canceling");
    phaseRef.current = "canceling";
    rafRef.current = requestAnimationFrame(cancelTick);
  };

  const onUp = async () => {
    if (phaseRef.current !== "holding") return;
    cancelAnimationFrame(rafRef.current);
    if (progress >= 1) {
      // Complete — trigger delete
      setPhase("deleting");
      phaseRef.current = "deleting";
      try {
        await onDelete();
      } catch {
        setPhase("idle");
        setProgress(0);
      }
    } else {
      cancelHold();
    }
  };

  const prevent = (e: React.SyntheticEvent) => e.preventDefault();

  const disabled = isDisabled || phase === "deleting";
  const holding = phase === "holding";
  const p = phase === "deleting" ? 1 : progress;

  // Per-tile scale: staggered cascade — each tile starts filling at a different time
  const tileScales = TILE_ORDER.map((ord) => Math.max(0, Math.min(1, (p - ord * 0.09) / 0.22)));

  const tooltipContent = holding ? (
    progress >= 1 ? (
      <span>
        Release to delete
        <br />
        <span className="text-muted" style={{ fontSize: 10 }}>
          Hover outside to cancel
        </span>
      </span>
    ) : (
      "Keep holding..."
    )
  ) : phase === "deleting" ? (
    "Deleting..."
  ) : (
    "Hold to delete"
  );

  const tooltipOpen = holding ? true : phase === "canceling" || phase === "deleting" ? false : undefined;

  return (
    <Tooltip delay={phase === "idle" ? 500 : 0} isOpen={tooltipOpen}>
      <Tooltip.Trigger>
        <button
          className="relative overflow-hidden grid place-items-center select-none"
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            border: `1.5px solid ${p > 0 ? "var(--danger)" : "var(--separator)"}`,
            background: "var(--surface)",
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.5 : 1,
            padding: 0,
            touchAction: "none",
            transform: phase === "deleting" ? "scale(.94)" : holding ? "scale(1.06)" : "scale(1)",
            transition: "transform .34s cubic-bezier(.34,1.56,.64,1)",
            isolation: "isolate",
          }}
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerLeave={cancelHold}
          onContextMenu={prevent}
          disabled={disabled}
        >
          {/* 3×3 tile grid overlay */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              zIndex: 1,
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gridTemplateRows: "repeat(3, 1fr)",
            }}
          >
            {tileScales.map((scale, i) => (
              <div
                key={i}
                style={{
                  background: "var(--danger)",
                  transform: `scale(${scale.toFixed(3)})`,
                  transformOrigin: "center",
                  transition: "transform .12s ease",
                }}
              />
            ))}
          </div>
          <TrashIcon
            className="size-3.5 relative"
            style={{
              zIndex: 3,
              color: p > 0.6 ? "var(--danger-foreground, #fff)" : "var(--danger)",
              transition: "color .2s ease",
            }}
          />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Content>{tooltipContent}</Tooltip.Content>
    </Tooltip>
  );
}



