import { Button, Dropdown, Label } from "@heroui/react";
import { CaretDownIcon } from "@phosphor-icons/react";

interface WriteQueueFooterProps {
  changeCount: number;
  onReset: () => void;
  onApply: () => void;
  onCopySql: () => void;
  isApplying: boolean;
}

export function WriteQueueFooter({ changeCount, onReset, onApply, onCopySql, isApplying }: WriteQueueFooterProps) {
  return (
    <div
      className="flex items-center justify-between gap-3 px-4.5 shrink-0 font-mono text-xs h-10"
      style={{
        borderTop: "1px solid var(--accent)",
        background: "color-mix(in oklch, var(--warning) 6%, var(--surface))",
      }}
    >
      <span style={{ color: "var(--accent)" }}>
        {changeCount} pending change{changeCount !== 1 ? "s" : ""}
      </span>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onReset} isDisabled={isApplying} className="text-xs h-7">
          Reset
        </Button>

        <div className="flex items-center">
          <Button
            size="sm"
            onClick={onApply}
            isDisabled={isApplying}
            className="text-xs h-7 rounded-r-none"
            style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}
          >
            {isApplying ? "Applying..." : "Apply"}
          </Button>
          <Dropdown>
            <Button
              size="sm"
              isIconOnly
              isDisabled={isApplying}
              className="h-7 w-6 rounded-l-none"
              style={{
                background: "var(--accent)",
                color: "var(--accent-foreground)",
                borderLeft: "1px solid color-mix(in oklch, var(--accent-foreground) 20%, transparent)",
              }}
            >
              <CaretDownIcon size={10} />
            </Button>
            <Dropdown.Popover className="w-[160px] p-1">
              <Dropdown.Menu
                onAction={(key) => {
                  if (key === "apply") onApply();
                  if (key === "copy-sql") onCopySql();
                }}
              >
                <Dropdown.Item id="apply" textValue="Apply changes">
                  <Label>Apply changes</Label>
                </Dropdown.Item>
                <Dropdown.Item id="copy-sql" textValue="Copy SQL">
                  <Label>Copy SQL</Label>
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      </div>
    </div>
  );
}
