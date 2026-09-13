import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { renderWithProviders } from "./testUtils";
import Breadcrumbs from "../components/Breadcrumbs";
import { BreadcrumbProvider, useBreadcrumbExtension } from "../context/BreadcrumbContext";

function Extension({ label }: { label: string }) {
  useBreadcrumbExtension(label);
  return null;
}

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <Breadcrumbs />
      {open && <Extension label="Acme Widgets" />}
      <button onClick={() => setOpen(false)}>close</button>
    </div>
  );
}

describe("Breadcrumbs", () => {
  it("shows Home / Group / Page for a nested nav item", () => {
    renderWithProviders(<Breadcrumbs />, { route: "/products" });
    expect(screen.getByLabelText("Breadcrumb")).toHaveTextContent("Home");
    expect(screen.getByLabelText("Breadcrumb")).toHaveTextContent("Inventory");
    expect(screen.getByLabelText("Breadcrumb")).toHaveTextContent("Products");
  });

  it("shows only Home on the dashboard", () => {
    renderWithProviders(<Breadcrumbs />, { route: "/" });
    expect(screen.getByLabelText("Breadcrumb")).toHaveTextContent("Home");
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
  });

  it("appends an open entity as the last crumb", () => {
    renderWithProviders(
      <BreadcrumbProvider>
        <Breadcrumbs />
        <Extension label="Acme Widgets" />
      </BreadcrumbProvider>,
      { route: "/customers" }
    );
    expect(screen.getByLabelText("Breadcrumb")).toHaveTextContent("Acme Widgets");
  });

  it("removes the entity crumb when the extension unmounts", () => {
    renderWithProviders(
      <BreadcrumbProvider>
        <Harness />
      </BreadcrumbProvider>,
      { route: "/customers" }
    );
    expect(screen.getByLabelText("Breadcrumb")).toHaveTextContent("Acme Widgets");
    fireEvent.click(screen.getByText("close"));
    expect(screen.getByLabelText("Breadcrumb")).not.toHaveTextContent("Acme Widgets");
  });
});