import { Button, Modal, Spinner } from "@heroui/react";
import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { save } from "@tauri-apps/plugin-dialog";
import { useExportDump } from "../../../hooks/useDump";
import { useDashboardContext } from "../../../hooks/dashboard/useDashboardContext";
import { getErrorMessage } from "../../../lib/error";

// ── Export database to .sql ──────────────────────────────────────────────────

interface ExportDumpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ExportDumpModal({ isOpen, onClose }: ExportDumpModalProps) {
  const { connection, connectionId, activeDatabase } = useDashboardContext();
  const exportDump = useExportDump();
  // The mutation's status is the modal's state: idle → pending → success | error
  const exporting = exportDump.isPending;
  const name = activeDatabase ?? connection?.config.name ?? "database";

  const handleClose = () => {
    if (exporting) return;
    exportDump.reset();
    onClose();
  };

  const handleConfirm = async () => {
    if (!connectionId) return;
    const filePath = await save({
      defaultPath: `${name}.sql`,
      filters: [{ name: "SQL", extensions: ["sql"] }],
    });
    // Cancelled the native dialog — stay on the confirmation screen
    if (!filePath) return;
    exportDump.mutate({
      connectionId,
      // SQLite has no database name to check against
      database: connection?.config.type === "sqlite" ? null : activeDatabase,
      filePath,
    });
  };

  const summary = exportDump.data;

  return (
    <Modal>
      <Modal.Backdrop
        isOpen={isOpen}
        isDismissable={!exporting}
        isKeyboardDismissDisabled
        onOpenChange={(open) => {
          if (!open) handleClose();
        }}
      >
        <Modal.Container>
          <Modal.Dialog className="max-w-md w-full flex flex-col">
            <div
              className="flex flex-col"
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
              <Modal.Header className="border-b border-separator shrink-0 pb-3 px-1">
                <Modal.Heading className="text-base font-medium">Export database</Modal.Heading>
                {!exporting && <Modal.CloseTrigger />}
              </Modal.Header>

              <Modal.Body className="flex flex-col gap-3 py-4 px-1 text-sm">
                {exportDump.status === "idle" && (
                  <p>
                    Export <span className="font-mono">{name}</span> on{" "}
                    <span className="font-medium">{connection?.config.name}</span> to a SQL file?
                  </p>
                )}

                {exportDump.status === "pending" && (
                  <div className="flex items-center gap-2.5">
                    <Spinner size="sm" />
                    <span>Exporting…</span>
                  </div>
                )}

                {exportDump.status === "success" && summary && (
                  <div className="flex items-start gap-2.5">
                    <CheckCircleIcon size={18} weight="fill" className="shrink-0 text-success" />
                    <div className="flex min-w-0 flex-col gap-1">
                      <span>
                        {summary.tablesExported.toLocaleString()} tables, {summary.viewsExported.toLocaleString()} views,{" "}
                        {summary.rowsExported.toLocaleString()} rows exported
                      </span>
                      <span className="break-all font-mono text-xs text-muted">{summary.filePath}</span>
                    </div>
                  </div>
                )}

                {exportDump.status === "error" && (
                  <p role="alert" className="flex items-start gap-2.5 text-danger">
                    <WarningCircleIcon size={18} className="shrink-0" />
                    <span className="min-w-0 break-words">{getErrorMessage(exportDump.error, "Export failed")}</span>
                  </p>
                )}
              </Modal.Body>

              <Modal.Footer className="border-t border-separator pt-3 flex justify-end gap-2 shrink-0">
                {exportDump.status === "idle" && (
                  <>
                    <Button size="sm" variant="outline" className="text-[13px] h-8" onPress={handleClose}>
                      Cancel
                    </Button>
                    <Button size="sm" variant="primary" className="text-[13px] h-8" onPress={handleConfirm}>
                      Export
                    </Button>
                  </>
                )}
                {exportDump.status === "pending" && (
                  <Button size="sm" variant="outline" className="text-[13px] h-8" isDisabled>
                    Cancel
                  </Button>
                )}
                {exportDump.status === "success" && (
                  <Button size="sm" variant="primary" className="text-[13px] h-8" onPress={handleClose}>
                    Done
                  </Button>
                )}
                {exportDump.status === "error" && (
                  <>
                    <Button size="sm" variant="outline" className="text-[13px] h-8" onPress={handleClose}>
                      Close
                    </Button>
                    <Button size="sm" variant="primary" className="text-[13px] h-8" onPress={() => exportDump.reset()}>
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
