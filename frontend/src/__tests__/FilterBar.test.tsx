import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import FilterBar, { type FilterBarItem } from "../components/FilterBar";

function Harness() {
  const [values, setValues] = useState<Record<string, string>>({});
  const items: FilterBarItem[] = [
    { type: "search", ariaLabel: "Search orders", placeholder: "Search by order number..." },
    {
      type: "select",
      key: "status",
      ariaLabel: "Filter by status",
      placeholder: "All statuses",
      options: [
        { value: "pending", label: "Pending" },
        { value: "received", label: "Received" },
      ],
    },
  ];
  return (
    <FilterBar
      items={items}
      values={values}
      setFilter={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
      onReset={() => setValues({})}
    />
  );
}

describe("FilterBar", () => {
  it("renders the search input and filter selects", () => {
    renderWithProviders(<Harness />);
    expect(screen.getByLabelText("Search orders")).toHaveAttribute("placeholder", "Search by order number...");
    expect(screen.getByRole("combobox", { name: "Filter by status" })).toBeInTheDocument();
  });

  it("updates the search value and reveals the clear action", () => {
    renderWithProviders(<Harness />);
    const input = screen.getByLabelText("Search orders");
    fireEvent.change(input, { target: { value: "PO-1001" } });
    expect(screen.getByLabelText("Search orders")).toHaveValue("PO-1001");
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("clears filters when the clear action is clicked", () => {
    renderWithProviders(<Harness />);
    fireEvent.change(screen.getByLabelText("Search orders"), { target: { value: "PO-1001" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByLabelText("Search orders")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("selecting a filter option updates the value", () => {
    renderWithProviders(<Harness />);
    fireEvent.click(screen.getByRole("combobox", { name: "Filter by status" }));
    fireEvent.click(screen.getByRole("option", { name: "Pending" }));
    expect(screen.getByRole("combobox", { name: "Filter by status" })).toHaveValue("Pending");
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });
});