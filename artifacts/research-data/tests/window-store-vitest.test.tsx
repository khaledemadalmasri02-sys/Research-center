import { render, act } from "@testing-library/react";
import {
  WindowStoreProvider,
  useDesktopState,
  useDesktopActions,
} from "@/components/desktop/window-store";
import type { DesktopWindow } from "@/components/desktop/window-store";

let state: { windows: DesktopWindow[]; activeId: string | null };
let actions: ReturnType<typeof useDesktopActions>;

function Harness() {
  state = useDesktopState();
  actions = useDesktopActions();
  return null;
}

describe("window-store: singleton route sync", () => {
  it("updates the route of an existing singleton window when reopened (View button -> patient-view)", () => {
    render(
      <WindowStoreProvider>
        <Harness />
      </WindowStoreProvider>,
    );

    // First open of the singleton `patient-view` app creates a new window
    // with the requested route (simulating clicking patient #133).
    act(() => actions.open("patient-view", { route: "/patients/133" }));

    let win = state.windows.find((w) => w.appId === "patient-view");
    expect(win).toBeDefined();
    expect(win?.route).toBe("/patients/133");
    expect(win?.minimized).toBe(false);

    // Reopen the SAME singleton app for a different record (clicking patient
    // #456). The existing window must be reused and its route updated to the
    // newly clicked record rather than staying on #133.
    act(() => actions.open("patient-view", { route: "/patients/456" }));

    win = state.windows.find((w) => w.appId === "patient-view");
    expect(win).toBeDefined();
    expect(win?.route).toBe("/patients/456");
    expect(win?.minimized).toBe(false);
  });

  it("updates the route of an existing singleton window when reopened (Edit button -> patient-edit)", () => {
    render(
      <WindowStoreProvider>
        <Harness />
      </WindowStoreProvider>,
    );

    act(() => actions.open("patient-edit", { route: "/patients/133/edit" }));
    act(() => actions.open("patient-edit", { route: "/patients/456/edit" }));

    const win = state.windows.find((w) => w.appId === "patient-edit");
    expect(win).toBeDefined();
    expect(win?.route).toBe("/patients/456/edit");
  });

  it("keeps non-singleton apps opening new windows instead of reusing", () => {
    render(
      <WindowStoreProvider>
        <Harness />
      </WindowStoreProvider>,
    );

    // records/:definitionId is NOT a singleton, so each open spawns a window.
    act(() => actions.open("records/:definitionId", { route: "/records/10" }));
    act(() => actions.open("records/:definitionId", { route: "/records/11" }));

    const wins = state.windows.filter((w) => w.appId === "records/:definitionId");
    expect(wins).toHaveLength(2);
    expect(wins.map((w) => w.route)).toEqual(["/records/10", "/records/11"]);
  });
});
