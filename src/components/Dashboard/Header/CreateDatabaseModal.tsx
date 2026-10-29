import { useEffect, useState } from "react";
import { Button, Input, Label, Modal, Spinner, TextField } from "@heroui/react";
import { WarningCircleIcon } from "@phosphor-icons/react";
import { useCreateDatabase } from "../../../hooks/useConnections";
import { useDashboardContext } from "../../../hooks/dashboard/useDashboardContext";
import { useDashboardCommands } from "../../../hooks/dashboard/useDashboardCommands";
import { getErrorMessage } from "../../../lib/error";

// ── Create a new database on the active connection ──────────────────────────

interface CreateDatabaseModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateDatabaseModal({ isOpen, onClose }: CreateDatabaseModalProps) {
  const { connectionId } = useDashboardContext();
  const commands = useDashboardCommands();
  const createDatabase = useCreateDatabase();
  const [name, setName] = useState("");
  const creating = createDatabase.isPending;

  // Reset the form each time the modal is opened
  useEffect(() => {
    if (isOpen) {
      setName("");
      createDatabase.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleClose = () => {
    if (creating) return;
    onClose();
  };

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!connectionId || !trimmed) return;
    createDatabase.mutate(
      { connectionId, name: trimmed },
      {
        onSuccess: () => {
          commands.selectDatabase(trimmed);
          onClose();
        },
      },
    );
  };

  return (
    <Modal>
      <Modal.Backdrop
        isOpen={isOpen}
        isDismissable={!creating}
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
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCreate();
                }
              }}
            >
              <Modal.Header className="border-b border-separator shrink-0 pb-3 px-1">
                <Modal.Heading className="text-base font-medium">New database</Modal.Heading>
                {!creating && <Modal.CloseTrigger />}
              </Modal.Header>

              <Modal.Body className="flex flex-col gap-3 pt-4 pb-1 px-1 text-sm">
                <TextField autoFocus value={name} onChange={setName} isDisabled={creating}>
                  <Label className="text-xs text-muted">Database name</Label>
                  <Input
                    placeholder="my_new_database"
                    className="mt-1 border border-separator font-mono text-[13px]"
                  />
                </TextField>

                {createDatabase.isError && (
                  <p role="alert" className="flex items-start gap-2.5 text-danger">
                    <WarningCircleIcon size={18} className="shrink-0" />
                    <span className="min-w-0 break-words">
                      {getErrorMessage(createDatabase.error, "Failed to create database")}
                    </span>
                  </p>
                )}
              </Modal.Body>

              <Modal.Footer className="border-t border-separator pt-3 flex justify-end gap-2 shrink-0">
                <Button size="sm" variant="outline" className="text-[13px] h-8" onPress={handleClose} isDisabled={creating}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  className="text-[13px] h-8"
                  onPress={handleCreate}
                  isDisabled={creating || !name.trim()}
                >
                  {creating ? <Spinner size="sm" color="current" /> : "Create"}
                </Button>
              </Modal.Footer>
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
