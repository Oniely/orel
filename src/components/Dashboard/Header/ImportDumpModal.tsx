import { useState } from "react";
import { Button, Input, Label, Modal, TextField } from "@heroui/react";
import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";
import { useImportDump } from "../../../hooks/useDump";
import type { ImportError } from "../../../types/dump";

// ── Import .sql file ─────────────────────────────────────────────────────────

interface ImportDumpModalProps {
  isOpen: boolean;
  connectionId: string;
  /** MySQL auto-commits DDL, so any table a failed statement created stays */
  isMySql: boolean;
  /** Called once an import has run, even with failed statements */
  onImported: () => void;
  onClose: () => void;
}

function ImportErrorList({ errors }: { errors: ImportError[] }) {
  return (
    <div className="flex max-h-56 flex-col gap-2 overflow-y-auto">
      {errors.map((error, i) => (
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
  );
}

export function ImportDumpModal({ isOpen, connectionId, isMySql, onImported, onClose }: ImportDumpModalProps) {
  const importDump = useImportDump();
  const [filePath, setFilePath] = useState<string | null>(null);
  // The mutation's status is the modal's phase: idle (pick file) → pending → success | error
  const importing = importDump.isPending;
  const { done, total, errors } = importDump.progress;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const summary = importDump.data;
  const failed = summary !== undefined && summary.statementsFailed > 0;

  const handleClose = () => {
    if (importing) return;
    importDump.reset();
    setFilePath(null);
    onClose();
  };

  const handleBrowse = async () => {
    const selected = await open({ multiple: false, filters: [{ name: "SQL", extensions: ["sql"] }] });
    if (selected) setFilePath(selected);
  };

  const handleImport = () => {
    if (!filePath) return;
    importDump.mutate({ connectionId, filePath }, { onSuccess: onImported });
  };

  return (
    <Modal>
      <Modal.Backdrop
        isOpen={isOpen}
        isDismissable={!importing}
        isKeyboardDismissDisabled
        onOpenChange={(open) => {
          if (!open) handleClose();
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
                  handleClose();
                }
              }}
            >
              <Modal.Header className="shrink-0 pb-2 px-1">
                <Modal.Heading className="text-base font-medium">
                  {importDump.status === "success"
                    ? failed
                      ? "Import finished with errors"
                      : "Import complete"
                    : "Import SQL file"}
                </Modal.Heading>
                {!importing && <Modal.CloseTrigger />}
              </Modal.Header>

              <Modal.Body className="flex flex-col gap-2 pt-1 pb-1 px-1 text-sm overflow-y-auto scrollbar-hide">
                {importDump.status === "idle" && (
                  <TextField isReadOnly value={filePath ?? ""}>
                    <Label className="text-xs font-medium text-muted">SQL file</Label>
                    <div className="flex gap-2 mt-1">
                      <Input placeholder="Choose a .sql file…" className="flex-1 border border-separator px-3 py-1.5" />
                      <Button
                        autoFocus
                        size="sm"
                        variant="outline"
                        className="text-[13px] h-8 w-[104px] justify-center"
                        onPress={handleBrowse}
                      >
                        Browse
                      </Button>
                    </div>
                  </TextField>
                )}

                {importing && (
                  <div>
                    <p>Importing…</p>
                    <div
                      className="mt-4 h-2 overflow-hidden rounded-full bg-surface-secondary"
                      role="progressbar"
                      aria-label="Import progress"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percent}
                    >
                      <div
                        className="h-full rounded-full bg-accent transition-[width] duration-200"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <p className="mt-2 text-right font-mono text-xs text-muted">
                      {done.toLocaleString()} / {total.toLocaleString()} statements
                      {errors.length > 0 && `, ${errors.length.toLocaleString()} failed`}
                    </p>
                  </div>
                )}

                {importing && errors.length > 0 && <ImportErrorList errors={errors} />}

                {importDump.status === "success" && summary && (
                  <>
                    <p className={`flex items-start gap-2.5 ${failed ? "text-warning" : "text-success"}`}>
                      {failed ? (
                        <WarningCircleIcon size={18} className="shrink-0" />
                      ) : (
                        <CheckCircleIcon size={18} weight="fill" className="shrink-0" />
                      )}
                      <span className="min-w-0">
                        {summary.statementsExecuted.toLocaleString()} statement
                        {summary.statementsExecuted === 1 ? "" : "s"} executed
                        {failed && `, ${summary.statementsFailed.toLocaleString()} failed`}
                      </span>
                    </p>

                    {failed && <ImportErrorList errors={summary.errors} />}

                    {failed &&
                      (isMySql ? (
                        <p className="text-warning">
                          MySQL doesn't support rolling back table creation, so tables from the failed statements above
                          may have already been created.
                        </p>
                      ) : (
                        <p className="text-muted">
                          Statements run independently — earlier successful statements were not rolled back.
                        </p>
                      ))}
                  </>
                )}

                {importDump.status === "error" && (
                  <p role="alert" className="flex items-start gap-2.5 text-danger">
                    <WarningCircleIcon size={18} className="shrink-0" />
                    <span className="min-w-0 break-words">{importDump.error}</span>
                  </p>
                )}
              </Modal.Body>

              <Modal.Footer className="pt-2 flex justify-end gap-2 shrink-0">
                {importDump.status === "idle" && (
                  <>
                    <Button size="sm" variant="outline" className="text-[13px] h-8" onPress={handleClose}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      className="text-[13px] h-8 w-[104px] justify-center"
                      isDisabled={!filePath}
                      onPress={handleImport}
                    >
                      Import Now
                    </Button>
                  </>
                )}
                {importing && (
                  <Button size="sm" variant="outline" className="text-[13px] h-8" isDisabled>
                    Close
                  </Button>
                )}
                {importDump.status === "success" && (
                  <Button size="sm" variant="primary" className="text-[13px] h-8" onPress={handleClose}>
                    Close
                  </Button>
                )}
                {importDump.status === "error" && (
                  <>
                    <Button size="sm" variant="outline" className="text-[13px] h-8" onPress={handleClose}>
                      Close
                    </Button>
                    <Button size="sm" variant="primary" className="text-[13px] h-8" onPress={() => importDump.reset()}>
                      Try again
                    </Button>
                  </>
                )}
              </Modal.Footer>
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
