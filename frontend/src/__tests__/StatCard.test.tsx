import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { Package, ShoppingCart } from "lucide-react";
import { renderWithProviders } from "./testUtils";
import StatCard, { KpiGrid } from "../components/StatCard";

describe("StatCard", () => {
  it("renders label and value", () => {
    const { container } = renderWithProviders(<StatCard label="Total stock" value="$1,234" icon={Package} tone="emerald" />);
    expect(screen.getByText("Total stock")).toBeInTheDocument();
    expect(screen.getByText("$1,234")).toBeInTheDocument();
    const tile = container.querySelector("span");
    expect(tile).toHaveClass("bg-emerald-500/10");
    expect(tile).toHaveClass("text-emerald-600");
  });

  it("applies the default tile tone when none is passed", () => {
    const { container } = renderWithProviders(<StatCard label="Orders" value="12" icon={Package} />);
    const tile = container.querySelector("span");
    expect(tile).toHaveClass("bg-subtle");
  });

  it("links to a route when `to` is provided", () => {
    renderWithProviders(<StatCard label="Open PO" value="3" icon={ShoppingCart} to="/orders" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/orders");
    expect(screen.getByText("Open PO")).toBeInTheDocument();
  });

  it("fires onClick when interactive", () => {
    const onClick = vi.fn();
    renderWithProviders(<StatCard label="Checked" value="7" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("KpiGrid", () => {
  it("wraps cards in a responsive grid with the requested column target", () => {
    const { container } = renderWithProviders(
      <KpiGrid columns={3}>
        <StatCard label="A" value="1" />
        <StatCard label="B" value="2" />
      </KpiGrid>,
    );
    const grid = container.firstChild;
    expect(grid).toHaveClass("grid");
    expect(grid).toHaveClass("sm:grid-cols-3");
    expect(grid).not.toHaveClass("lg:grid-cols-4");
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });
});