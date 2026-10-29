import { Button, Modal } from "@heroui/react";
import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { ImportSummary } from "../../../types/dump";

// ── Import result ─────────────────────────────────────────────────────────────

interface ImportResultModalProps {
  summary: ImportSummary | null;
  /** MySQL auto-commits DDL, so any table a failed statement created stays */
  isMySql: boolean;
  onClose: () => void;
}

export function ImportResultModal({ summary, isMySql, onClose }: ImportResultModalProps) {
  const failed = summary !== null && summary.statementsFailed > 0;

  return (
    <Modal>
      <Modal.Backdrop
        isOpen={summary !== null}
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
                <Modal.Heading className="text-base font-medium">
                  {failed ? "Import finished with errors" : "Import complete"}
                </Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>

              <Modal.Body className="flex flex-col gap-3 pt-4 pb-1 px-1 text-sm overflow-y-auto scrollbar-hide">
                <p className={`flex items-start gap-2.5 ${failed ? "text-warning" : "text-success"}`}>
                  {failed ? (
                    <WarningCircleIcon size={18} className="shrink-0" />
                  ) : (
                    <CheckCircleIcon size={18} weight="fill" className="shrink-0" />
                  )}
                  <span className="min-w-0">
                    {summary?.statementsExecuted.toLocaleString()} statement
                    {summary?.statementsExecuted === 1 ? "" : "s"} executed
                    {failed && `, ${summary.statementsFailed.toLocaleString()} failed`}
                  </span>
                </p>

                {failed && (
                  <div className="flex flex-col gap-2">
                    {summary.errors.map((error, i) => (
                      <div key={i} className="rounded-lg border border-separator bg-surface-secondary p-2.5">
                        <p role="alert" className="flex items-start gap-2.5 text-danger">
                          <WarningCircleIcon size={16} className="shrink-0 mt-0.5" />
                          <span className="min-w-0 break-words">{error.message}</span>
                        </p>
                        {error.snippet && (
                          <>
                            {error.line !== null && <div className="mt-2 mb-1 text-xs text-muted">Line {error.line}</div>}
                            <pre className="whitespace-pre-wrap break-all font-mono text-xs">{error.snippet}</pre>
                          </>
                        )}
                        {error.hint && <p className="mt-1 text-muted">{error.hint}</p>}
                      </div>
                    ))}
                  </div>
                )}

                {failed &&
                  (isMySql ? (
                    <p className="text-warning">
                      MySQL doesn't support rolling back table creation, so tables from the failed statements above may
                      have already been created.
                    </p>
                  ) : (
                    <p className="text-muted">
                      Statements run independently — earlier successful statements were not rolled back.
                    </p>
                  ))}
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
