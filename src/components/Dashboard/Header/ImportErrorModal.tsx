import { Button, Modal } from "@heroui/react";
import { WarningCircleIcon } from "@phosphor-icons/react";
import type { ImportError } from "../../../types/dump";

// ── Import failure details ───────────────────────────────────────────────────

interface ImportErrorModalProps {
  error: ImportError | null;
  /** MySQL auto-commits DDL, so a failed import can leave tables behind */
  isMySql: boolean;
  onClose: () => void;
}

export function ImportErrorModal({ error, isMySql, onClose }: ImportErrorModalProps) {
  return (
    <Modal>
      <Modal.Backdrop
        isOpen={error !== null}
        isKeyboardDismissDisabled
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <Modal.Container>
          <Modal.Dialog className="max-w-lg w-full flex flex-col max-h-[90vh]">
            <div
              className="flex min-h-0 flex-col"
              onKeyDown={(e) => {
                // Keys stop here so dashboard hotkeys behind the modal don't fire.
                // Tab is left alone for the modal's focus trap.
                if (e.key !== "Tab") e.stopPropagation();
                if (e.key === "Escape") {
                  e.preventDefault();
                  onClose();
                }
              }}
            >
              <Modal.Header className="border-b border-separator shrink-0 pb-3 px-1">
                <Modal.Heading className="text-base font-medium">Import failed</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>

              <Modal.Body className="flex flex-col gap-3 py-4 px-1 text-sm overflow-y-auto scrollbar-hide">
                <p role="alert" className="flex items-start gap-2.5 text-danger">
                  <WarningCircleIcon size={18} className="shrink-0" />
                  <span className="min-w-0 break-words">{error?.message}</span>
                </p>

                {error?.snippet && (
                  <div className="rounded-lg border border-separator bg-surface-secondary p-2.5">
                    {error.line !== null && <div className="mb-1 text-xs text-muted">Line {error.line}</div>}
                    <pre className="whitespace-pre-wrap break-all font-mono text-xs">{error.snippet}</pre>
                  </div>
                )}

                {error?.hint && <p className="text-muted">{error.hint}</p>}

                {isMySql ? (
                  <p className="text-warning">
                    Import stopped partway through. MySQL doesn't support rolling back table creation, so some tables
                    from this file may have already been created even though the import failed.
                  </p>
                ) : (
                  <p className="text-muted">No changes were made — the import was rolled back.</p>
                )}
              </Modal.Body>

              <Modal.Footer className="border-t border-separator pt-3 flex justify-end gap-2 shrink-0">
                <Button size="sm" variant="primary" className="text-[13px] h-8" onPress={onClose}>
                  Close
                </Button>
              </Modal.Footer>
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
