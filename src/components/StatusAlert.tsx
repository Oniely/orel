import { Alert } from "@heroui/react";

// ── Status alert (save / validation / load errors) ───────────────────────────
// Shared across edit surfaces (table structure tabs, database modals, ...).

interface StatusAlertProps {
  status: "danger" | "warning";
  /** Full-width strip under a toolbar/at the bottom of a panel instead of a centered box */
  banner?: boolean;
  children: React.ReactNode;
}

// HeroUI's Alert is top-aligned for title + description; a one-line message
// needs to be centered on the (24px) indicator instead.
export function StatusAlert({ status, banner, children }: StatusAlertProps) {
  const layout = banner ? "rounded-none border-b border-separator px-4.5 py-2 shrink-0" : "max-w-md";
  return (
    <Alert status={status} className={`items-center gap-2.5 ${layout}`}>
      <Alert.Indicator />
      <Alert.Content className="justify-center">
        <Alert.Description className="text-xs">{children}</Alert.Description>
      </Alert.Content>
    </Alert>
  );
}
