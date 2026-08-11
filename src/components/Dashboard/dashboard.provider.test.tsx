import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DashboardStoreProvider, useDashboardStore } from "../../stores/dashboard.store";

afterEach(cleanup);

function StoreHarness() {
  const tabCount = useDashboardStore(
    (state) => state.tabState["connection::main"]?.tabs.length ?? 0,
  );
  const openTable = useDashboardStore((state) => state.openTable);

  return (
    <div>
      <span data-testid="tab-count">{tabCount}</span>
      <button onClick={() => openTable("connection::main", "users")}>Open users</button>
    </div>
  );
}

describe("DashboardStoreProvider", () => {
  it("updates selector subscribers without dashboard prop plumbing", async () => {
    const user = userEvent.setup();
    render(
      <DashboardStoreProvider>
        <StoreHarness />
      </DashboardStoreProvider>,
    );

    expect(screen.getByTestId("tab-count").textContent).toBe("0");
    await user.click(screen.getByRole("button", { name: "Open users" }));
    expect(screen.getByTestId("tab-count").textContent).toBe("1");
  });

  it("creates fresh state after the dashboard provider unmounts", async () => {
    const user = userEvent.setup();
    const firstMount = render(
      <DashboardStoreProvider>
        <StoreHarness />
      </DashboardStoreProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Open users" }));
    expect(screen.getByTestId("tab-count").textContent).toBe("1");
    firstMount.unmount();

    render(
      <DashboardStoreProvider>
        <StoreHarness />
      </DashboardStoreProvider>,
    );
    expect(screen.getByTestId("tab-count").textContent).toBe("0");
  });
});

