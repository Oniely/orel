import { beforeEach, describe, expect, it } from "vitest";
import { newPendingIndex } from "../components/Dashboard/TableStructure/IndexesTable";
import { useStructureDraftsStore } from "./structure-drafts.store";

const users = "conn::app::users";
const orders = "conn::app::orders";

describe("structure drafts store", () => {
  beforeEach(() => {
    useStructureDraftsStore.setState(useStructureDraftsStore.getInitialState());
  });

  it("keeps drafts isolated by table and tab", () => {
    const { updateDraft } = useStructureDraftsStore.getState();
    updateDraft("indexes", users, (draft) => ({ ...draft, drops: ["users_email_idx"] }));
    updateDraft("foreignKeys", users, (draft) => ({ ...draft, drops: ["users_org_fkey"] }));

    const { drafts } = useStructureDraftsStore.getState();
    expect(drafts.indexes[users].drops).toEqual(["users_email_idx"]);
    expect(drafts.foreignKeys[users].drops).toEqual(["users_org_fkey"]);
    expect(drafts.indexes[orders]).toBeUndefined();
    expect(drafts.columns[users]).toBeUndefined();
  });

  it("clears one tab's draft without touching the others", () => {
    const { updateDraft, clearDraft } = useStructureDraftsStore.getState();
    updateDraft("columns", users, (draft) => ({ ...draft, deletes: ["email"] }));
    updateDraft("columns", orders, (draft) => ({ ...draft, deletes: ["total"] }));
    updateDraft("indexes", users, (draft) => ({ ...draft, drops: ["users_email_idx"] }));

    clearDraft("columns", users);

    const { drafts } = useStructureDraftsStore.getState();
    expect(drafts.columns[users]).toBeUndefined();
    expect(drafts.columns[orders].deletes).toEqual(["total"]);
    expect(drafts.indexes[users].drops).toEqual(["users_email_idx"]);
  });

  it("appends staged rows", () => {
    const { stageAdd } = useStructureDraftsStore.getState();
    stageAdd("indexes", users, newPendingIndex("users", "email"));
    stageAdd("indexes", users, newPendingIndex("users", "name", true));

    expect(useStructureDraftsStore.getState().drafts.indexes[users].adds.map((a) => a.name)).toEqual([
      "users_email_idx",
      "users_name_key",
    ]);
  });

  it("drops a draft once every change is undone", () => {
    const { updateDraft } = useStructureDraftsStore.getState();
    updateDraft("columns", users, (draft) => ({ ...draft, edits: { email: { name: "mail" } } }));
    updateDraft("columns", users, (draft) => ({ ...draft, edits: {} }));

    expect(useStructureDraftsStore.getState().drafts.columns[users]).toBeUndefined();
  });
});
