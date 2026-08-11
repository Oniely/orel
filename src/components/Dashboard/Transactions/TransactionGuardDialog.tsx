import { AlertDialog, Button, Spinner, toast } from "@heroui/react";
import {
  useCommitEditorTransaction,
  useRollbackEditorTransaction,
} from "../../../hooks/useSqlEditor";
import { getErrorMessage } from "../../../lib/error";
import { useDashboardStore, useDashboardStoreApi } from "../../../stores/dashboard.store";
import { useDashboardCommands } from "../../../hooks/dashboard/useDashboardCommands";

export function TransactionGuardDialog() {
  const guard = useDashboardStore((state) => state.transactionGuard);
  const store = useDashboardStoreApi();
  const commands = useDashboardCommands();
  const commitTransaction = useCommitEditorTransaction();
  const rollbackTransaction = useRollbackEditorTransaction();
  const pending = commitTransaction.isPending || rollbackTransaction.isPending;

  const resolveTransaction = (editorId: string, action: "commit" | "rollback") => {
    const currentGuard = store.getState().transactionGuard;
    if (!currentGuard) return;
    const mutation = action === "commit" ? commitTransaction : rollbackTransaction;
    mutation.mutate(editorId, {
      onSuccess: () => {
        const state = store.getState();
        state.markEditorTransactionInactive(editorId);
        if (action === "commit") commands.refresh();
        toast.success(
          action === "commit" ? "Transaction committed" : "Transaction rolled back",
        );
        const latestGuard = store.getState().transactionGuard;
        if (!latestGuard) return;
        const remaining = latestGuard.editorIds.filter((id) => id !== editorId);
        if (remaining.length === 0) {
          state.setTransactionGuard(null);
          commands.performIntent(latestGuard.intent);
        } else {
          state.setTransactionGuard({ ...latestGuard, editorIds: remaining });
        }
      },
      onError: (error) =>
        toast.danger(getErrorMessage(error, `Failed to ${action} transaction`)),
    });
  };

  return (
    <AlertDialog>
      <AlertDialog.Backdrop
        isOpen={guard !== null}
        isDismissable={!pending}
        isKeyboardDismissDisabled={pending}
        onOpenChange={(open) => {
          if (!open) store.getState().setTransactionGuard(null);
        }}
      >
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>{guard?.title}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>{guard?.description}</p>
              <div className="mt-4 space-y-2">
                {guard?.editorIds.map((editorId) => {
                  const guardedTab = Object.values(store.getState().tabState)
                    .flatMap((value) => value.tabs)
                    .find((tab) => tab.id === editorId);
                  const failed =
                    guardedTab?.type === "query" &&
                    guardedTab.editorState.transactionState === "failed";
                  return (
                    <div
                      key={editorId}
                      className="flex items-center gap-2 rounded-lg border border-separator bg-surface-secondary p-2.5"
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">
                        {guardedTab?.label ?? editorId}
                      </span>
                      <Button
                        size="sm"
                        variant="danger-soft"
                        isDisabled={pending}
                        onClick={() => resolveTransaction(editorId, "rollback")}
                      >
                        {rollbackTransaction.isPending ? <Spinner size="sm" /> : "Rollback"}
                      </Button>
                      <Button
                        size="sm"
                        isDisabled={pending || failed}
                        onClick={() => resolveTransaction(editorId, "commit")}
                      >
                        {commitTransaction.isPending ? <Spinner size="sm" /> : "Commit"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button
                variant="outline"
                isDisabled={pending}
                onClick={() => store.getState().setTransactionGuard(null)}
              >
                Cancel
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}


