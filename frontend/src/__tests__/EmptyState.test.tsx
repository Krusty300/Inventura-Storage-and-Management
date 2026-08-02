import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import EmptyState from "../components/EmptyState";

function renderInTable(ui: React.ReactNode) {
  return render(
    <table>
      <tbody>{ui}</tbody>
    </table>
  );
}

describe("EmptyState", () => {
  it("renders title, message and action label", () => {
    renderInTable(<EmptyState title="No products" message="Add your first product." actionLabel="Add Product" onAction={() => {}} />);
    expect(screen.getByText("No products")).toBeInTheDocument();
    expect(screen.getByText("Add your first product.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Product" })).toBeInTheDocument();
  });

  it("renders defaults without an action button", () => {
    renderInTable(<EmptyState />);
    expect(screen.getByText("No data found")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("calls onAction when the action button is clicked", () => {
    const onAction = vi.fn();
    renderInTable(<EmptyState title="No products" message="Add your first product." actionLabel="Add Product" onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Product" }));
    expect(onAction).toHaveBeenCalled();
  });
});
