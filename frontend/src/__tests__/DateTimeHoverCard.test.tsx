import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DateTimeHoverCard from "../components/DateTimeHoverCard";
import FormattedDateTime from "../components/FormattedDateTime";
import { ThemeProvider } from "../context/ThemeContext";
import { makeQueryClient } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn() },
}));

const getMock = api.get as ReturnType<typeof vi.fn>;

function renderWithTheme(ui: ReactNode, queryClient?: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient ?? makeQueryClient()}>
      <ThemeProvider>{ui}</ThemeProvider>
    </QueryClientProvider>,
  );
}

function mockSettings(overrides: Record<string, unknown> = {}) {
  getMock.mockResolvedValue({
    data: { show_datetime_hover_cards: true, date_format: "YYYY-MM-DD", currency_symbol: "$", ...overrides },
  });
}

describe("DateTimeHoverCard", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it("renders a mini calendar with the hovered date highlighted", () => {
    renderWithTheme(<DateTimeHoverCard value="2026-01-05T14:03:00" label="Order placed" />);

    expect(screen.getByRole("grid", { name: "Mini calendar" })).toBeInTheDocument();
    expect(screen.getByText("January 2026")).toBeInTheDocument();
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((d) => expect(screen.getByText(d)).toBeInTheDocument());

    const highlighted = screen.getByRole("gridcell", { name: /January 5, 2026/ });
    expect(highlighted).toHaveAttribute("aria-current", "date");
    expect(highlighted.className).toContain("bg-primary-solid");
  });

  it("marks exactly one gridcell as the hovered date", () => {
    renderWithTheme(<DateTimeHoverCard value="2026-01-15T09:30:00" label="Order placed" />);
    const selected = screen.getAllByRole("gridcell", { name: /January 15, 2026/ });
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveAttribute("aria-current", "date");
    expect(selected[0].className).toContain("bg-primary-solid");
  });

  it("does not render a live clock alongside the calendar", () => {
    renderWithTheme(<DateTimeHoverCard value="2026-01-05T14:03:00" label="Order placed" />);
    expect(screen.queryByLabelText("Animated clock")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Live clock")).not.toBeInTheDocument();
  });

  it("toggles the preview theme between light and dark", () => {
    renderWithTheme(<DateTimeHoverCard value="2026-01-05T14:03:00" label="Order placed" />);

    const toggle = screen.getByRole("switch", { name: "Toggle preview theme" });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });
});

describe("FormattedDateTime gating", () => {
  beforeEach(() => {
    getMock.mockReset();
    mockSettings({ show_datetime_hover_cards: true });
  });

  it("renders the formatted value and fallback without a card for null", async () => {
    renderWithTheme(<FormattedDateTime value={null} label="Order placed" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows the datetime hover card when enabled", async () => {
    const queryClient = makeQueryClient();
    renderWithTheme(<FormattedDateTime value="2026-01-05T14:03:00" label="Order placed" />, queryClient);
    const trigger = await screen.findByText("2026-01-05 14:03");
    await waitFor(() => expect(queryClient.getQueryData(["settings"])).toBeTruthy());
    fireEvent.mouseEnter(trigger);
    expect(await screen.findByRole("grid", { name: "Mini calendar" })).toBeInTheDocument();
  });

  it("does not show the card when disabled via settings", async () => {
    getMock.mockReset();
    mockSettings({ show_datetime_hover_cards: false });
    const queryClient = makeQueryClient();
    renderWithTheme(<FormattedDateTime value="2026-01-05T14:03:00" label="Order placed" />, queryClient);
    const trigger = await screen.findByText("2026-01-05 14:03");
    await waitFor(() => expect(queryClient.getQueryData(["settings"])).toBeTruthy());
    fireEvent.mouseEnter(trigger);
    expect(screen.queryByRole("grid", { name: "Mini calendar" })).not.toBeInTheDocument();
    expect(screen.getByText("2026-01-05 14:03")).toBeInTheDocument();
  });
});