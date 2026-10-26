import { useEffect } from "react";
import { Button, Modal, Spinner } from "@heroui/react";
import { useDropDatabase } from "../../../hooks/useConnections";
import { getErrorMessage } from "../../../lib/error";
import { StatusAlert } from "../../StatusAlert";

// ── Confirm dropping a database on the active connection ────────────────────

interface DeleteDatabaseModalProps {
  isOpen: boolean;
  connectionId: string;
  databaseName: string | null;
  onClose: () => void;
}

export function DeleteDatabaseModal({ isOpen, connectionId, databaseName, onClose }: DeleteDatabaseModalProps) {
  const dropDatabase = useDropDatabase();
  const deleting = dropDatabase.isPending;

  // Reset mutation state each time the modal is opened for a (possibly new) database
  useEffect(() => {
    if (isOpen) dropDatabase.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, databaseName]);

  const handleClose = () => {
    if (deleting) return;
    onClose();
  };

  const handleDelete = () => {
    if (!databaseName) return;
    dropDatabase.mutate(
      { connectionId, name: databaseName },
      {
        onSuccess: () => onClose(),
      },
    );
  };

  return (
    <Modal>
      <Modal.Backdrop
        isOpen={isOpen}
        isDismissable={!deleting}
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
                if (e.key !== "Tab") e.stopPropagation();
                if (e.key === "Escape") {
                  e.preventDefault();
                  handleClose();
                }
              }}
            >
              <Modal.Header className="border-b border-separator shrink-0 pb-3 px-1">
                <Modal.Heading className="text-base font-medium">Delete database</Modal.Heading>
                {!deleting && <Modal.CloseTrigger />}
              </Modal.Header>

              <Modal.Body className="flex flex-col gap-3 pt-4 pb-1 px-1 text-sm">
                <p>
                  This permanently deletes{" "}
                  <span className="font-mono text-[13px] text-foreground">{databaseName}</span> and everything in it.
                  This action cannot be undone.
                </p>
              </Modal.Body>

              {dropDatabase.isError && (
                <StatusAlert status="danger" banner>
                  {getErrorMessage(dropDatabase.error, "Failed to delete database")}
                </StatusAlert>
              )}

              <Modal.Footer className="border-t border-separator pt-3 flex justify-end gap-2 shrink-0">
                <Button size="sm" variant="outline" className="text-[13px] h-8" onPress={handleClose} isDisabled={deleting}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  className="text-[13px] h-8"
                  onPress={handleDelete}
                  isDisabled={deleting || !databaseName}
                >
                  {deleting ? <Spinner size="sm" /> : "Delete"}
                </Button>
              </Modal.Footer>
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
