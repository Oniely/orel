import { useEffect } from "react";
import { ConfirmDeleteDialog } from "../../shared/ConfirmDeleteDialog";
import { useDropDatabase } from "../../../hooks/useConnections";
import { getErrorMessage } from "../../../lib/error";

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
    <ConfirmDeleteDialog
      isOpen={isOpen}
      title="Delete database?"
      isPending={deleting}
      errorMessage={dropDatabase.isError ? getErrorMessage(dropDatabase.error, "Failed to delete database") : null}
      onCancel={handleClose}
      onConfirm={handleDelete}
    >
      This permanently deletes <ConfirmDeleteDialog.Name>{databaseName}</ConfirmDeleteDialog.Name> and everything in
      it. This action cannot be undone.
    </ConfirmDeleteDialog>
  );
}
