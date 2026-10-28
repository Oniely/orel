import type { ReactNode } from "react";
import { AlertDialog, Button, Spinner } from "@heroui/react";
import { WarningCircleIcon } from "@phosphor-icons/react";

// ── Reusable "delete this thing?" confirmation ───────────────────────────────
//
// Wraps the AlertDialog primitive so every destructive confirmation in the
// app (connections, databases, rows, ...) looks and behaves the same way:
// same header/body/footer layout, same disabled-while-pending behavior, same
// optional inline error banner, same styling for the highlighted item name.
//
// Usage:
//   <ConfirmDeleteDialog
//     isOpen={!!target}
//     title="Delete connection?"
//     isPending={deleteConnection.isPending}
//     errorMessage={deleteConnection.isError ? getErrorMessage(deleteConnection.error) : null}
//     onCancel={() => setTarget(null)}
//     onConfirm={() => deleteConnection.mutate(target.id)}
//   >
//     Are you sure you want to delete <ConfirmDeleteDialog.Name>{target?.name}</ConfirmDeleteDialog.Name>?
//     This cannot be undone.
//   </ConfirmDeleteDialog>

interface ConfirmDeleteDialogProps {
  isOpen: boolean;
  title: ReactNode;
  /** Body copy. Wrap the item name in <ConfirmDeleteDialog.Name> for consistent styling. */
  children: ReactNode;
  isPending: boolean;
  /** Shown as an inline danger banner under the body copy when set. */
  errorMessage?: string | null;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

function ConfirmDeleteDialogName({ children }: { children: ReactNode }) {
  return <strong className="font-mono text-[13px] text-foreground">{children}</strong>;
}

export function ConfirmDeleteDialog({
  isOpen,
  title,
  children,
  isPending,
  errorMessage,
  confirmLabel = "Delete",
  onCancel,
  onConfirm,
}: ConfirmDeleteDialogProps) {
  return (
    <AlertDialog>
      <AlertDialog.Backdrop
        isOpen={isOpen}
        isDismissable={!isPending}
        isKeyboardDismissDisabled={isPending}
        onOpenChange={(open) => {
          if (!open && !isPending) onCancel();
        }}
      >
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>{title}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="flex flex-col gap-3">
              <p>{children}</p>
              {errorMessage && (
                <p role="alert" className="flex items-start gap-2.5 text-danger">
                  <WarningCircleIcon size={18} className="shrink-0" />
                  <span className="min-w-0 break-words">{errorMessage}</span>
                </p>
              )}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button variant="outline" isDisabled={isPending} onPress={onCancel}>
                Cancel
              </Button>
              <Button variant="danger" isDisabled={isPending} onPress={onConfirm}>
                {isPending ? <Spinner size="sm" /> : confirmLabel}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}

ConfirmDeleteDialog.Name = ConfirmDeleteDialogName;
