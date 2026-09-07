import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

import ErrorBoundary from "./ErrorBoundary";

/** A component that throws on render to force the boundary to trip. */
function ThrowingChild({ message = "boom" }: { message?: string }): never {
  throw new Error(message);
}

function GoodChild() {
  return <div>happy path</div>;
}

describe("ErrorBoundary", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary fallback={<div>crashed</div>}>
        <GoodChild />
      </ErrorBoundary>,
    );
    expect(screen.getByText("happy path")).toBeInTheDocument();
    expect(screen.queryByText("crashed")).not.toBeInTheDocument();
  });

  it("renders the fallback when a child throws", () => {
    // React logs the error to the console — silence it so test output
    // stays clean.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary fallback={<div>crashed</div>}>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    expect(screen.getByText("crashed")).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it("POSTs a crash report to /crash-report with the error payload", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary fallback={<div>crashed</div>}>
        <ThrowingChild message="specific failure" />
      </ErrorBoundary>,
    );
    // The boundary reports the crash in an async IIFE, so wait for the
    // microtask queue to flush.
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/crash-report");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      kind: "react-component-error",
      message: "specific failure",
    });
    expect(typeof body.stack).toBe("string");
    expect(typeof body.ts).toBe("string");
    consoleError.mockRestore();
  });

  it("survives a failed crash-report POST (fallback still renders)", async () => {
    fetchSpy.mockRejectedValue(new Error("network down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary fallback={<div>crashed anyway</div>}>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    expect(screen.getByText("crashed anyway")).toBeInTheDocument();
    // Wait for the async reporter to settle so it doesn't bleed into
    // the next test.
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    consoleError.mockRestore();
  });
});
