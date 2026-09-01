import * as React from "react";
import { Sidebar } from "@/components/sidebar/Sidebar";

export default function SidebarPreview() {
  const [active, setActive] = React.useState("dashboard");

  return (
    <div className="flex min-h-screen w-full bg-gray-100 p-6 text-gray-900">
      <Sidebar onNavigate={setActive} />

      <main className="ml-6 flex-1">
        <div className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/5">
          <p className="text-xs font-semibold uppercase tracking-widest text-violet-600">
            Sidebar Demo
          </p>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">
            Active section:{" "}
            <span className="capitalize text-violet-600">{active}</span>
          </h1>
          <p className="mt-3 max-w-md text-sm text-gray-500">
            Click the toggle at the top to expand or collapse the sidebar. The
            active pill slides between items via a shared layout animation, and
            labels fade and stagger in. Toggle dark mode from the bottom row.
          </p>
        </div>
      </main>
    </div>
  );
}
