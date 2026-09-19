import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { Plus } from "lucide-react";
import { renderWithProviders } from "./testUtils";
import PageHeader from "../components/PageHeader";

describe("PageHeader", () => {
  it("renders title, subtitle, and actions", () => {
    renderWithProviders(
      <PageHeader
        title="Orders / Purchase Orders"
        subtitle="Place and receive orders with your suppliers."
        actions={<button className="btn-primary">New Order</button>}
      />,
    );
    expect(screen.getByRole("heading", { name: "Orders / Purchase Orders" })).toBeInTheDocument();
    expect(screen.getByText("Place and receive orders with your suppliers.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Order" })).toBeInTheDocument();
  });

  it("renders the icon tile when an icon is provided", () => {
    const { container } = renderWithProviders(<PageHeader title="Sales" icon={Plus} />);
    expect(screen.getByRole("heading", { name: "Sales" })).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders breadcrumbs when enabled", () => {
    renderWithProviders(<PageHeader title="Products" breadcrumbs />, { route: "/products" });
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Products" })).toBeInTheDocument();
  });

  it("omits the breadcrumb nav by default", () => {
    renderWithProviders(<PageHeader title="Products" />, { route: "/products" });
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).not.toBeInTheDocument();
  });
});