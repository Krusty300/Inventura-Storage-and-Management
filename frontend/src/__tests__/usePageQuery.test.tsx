import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";

vi.mock("../api/client", () => ({
  default: { get: vi.fn().mockRejectedValue(new Error("no network")) },
}));

vi.mock("../hooks/useSettings", () => ({
  useSettings: () => ({ data: {} }),
}));

import { usePageQuery } from "../hooks/usePageQuery";

function Harness() {
  const q = usePageQuery({ status: "" });
  return (
    <div>
      <p data-testid="search">{q.search}</p>
      <p data-testid="page">{q.page}</p>
      <p data-testid="filters">{JSON.stringify(q.filters)}</p>
      <p data-testid="params">{JSON.stringify(q.params)}</p>
      <button onClick={() => q.setSearch("needle")}>set search</button>
      <button onClick={() => q.setFilter("status", "pending")}>set status</button>
      <button onClick={() => q.setFilter("search", "via filter")}>set search via filter</button>
      <button onClick={() => q.setPage(3)}>set page 3</button>
      <button onClick={() => q.reset()}>reset</button>
    </div>
  );
}

describe("usePageQuery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
    vi.clearAllMocks();
    localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  function click(name: string) {
    act(() => {
      fireEvent.click(screen.getByRole("button", { name }));
    });
  }

  it("starts from defaults and builds params with skip/limit", () => {
    renderWithProviders(<Harness />);
    expect(screen.getByTestId("search")).toHaveTextContent("");
    expect(screen.getByTestId("filters")).toHaveTextContent('{"status":""}');
    expect(screen.getByTestId("params")).toHaveTextContent('{"skip":"0","limit":"25"}');
  });

  it("seeds search from the URL query param", () => {
    window.history.replaceState({}, "", "/orders?search=PO-1001");
    renderWithProviders(<Harness />);
    expect(screen.getByTestId("search")).toHaveTextContent("PO-1001");
    window.history.replaceState({}, "", "/");
  });

  it("sets a filter and resets the page", () => {
    renderWithProviders(<Harness />);
    click("set page 3");
    click("set status");
    expect(screen.getByTestId("filters")).toHaveTextContent('{"status":"pending"}');
    expect(screen.getByTestId("page")).toHaveTextContent("1");
    expect(screen.getByTestId("params")).toHaveTextContent('{"skip":"0","limit":"25","status":"pending"}');
  });

  it("debounces search and includes it in params once settled", () => {
    renderWithProviders(<Harness />);
    click("set status");
    click("set search");
    expect(screen.getByTestId("search")).toHaveTextContent("needle");
    expect(screen.getByTestId("params")).toHaveTextContent('{"skip":"0","limit":"25","status":"pending"}');
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByTestId("params")).toHaveTextContent('{"skip":"0","limit":"25","search":"needle","status":"pending"}');
  });

  it("routes setFilter('search', v) through the search field", () => {
    renderWithProviders(<Harness />);
    click("set search via filter");
    expect(screen.getByTestId("search")).toHaveTextContent("via filter");
  });

  it("reset clears search and restores initial filters", () => {
    renderWithProviders(<Harness />);
    click("set status");
    click("set search");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    click("reset");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByTestId("search")).toHaveTextContent("");
    expect(screen.getByTestId("filters")).toHaveTextContent('{"status":""}');
    expect(screen.getByTestId("params")).toHaveTextContent('{"skip":"0","limit":"25"}');
  });
});