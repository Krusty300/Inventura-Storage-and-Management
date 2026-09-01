import { screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import FloatingSidebar from "../components/FloatingSidebar";
import { renderWithProviders } from "./testUtils";

const onExpand = vi.fn();
const onClose = vi.fn();
const onWidthChange = vi.fn();

const defaultWidthProps = {
  onExpand,
  onClose,
  width: 72,
  onWidthChange,
  minWidth: 56,
  maxWidth: 200,
};

beforeEach(() => {
  onExpand.mockClear();
  onClose.mockClear();
  onWidthChange.mockClear();
  localStorage.removeItem("collapsedNavGroups");
});

describe("FloatingSidebar", () => {
  it("renders nav links for admin user", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} />);
    expect(screen.getByLabelText("Dashboard")).toBeInTheDocument();
    expect(screen.getByLabelText("Products")).toBeInTheDocument();
    expect(screen.getByLabelText("Settings")).toBeInTheDocument();
  });

  it("renders grouped sections with dividers", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} />);
    const dividers = document.querySelectorAll('[aria-hidden="true"].border-t');
    expect(dividers.length).toBeGreaterThanOrEqual(5);
  });

  it("marks active page", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} />, { route: "/products" });
    const link = screen.getByLabelText("Products");
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("hides tooltip and shows inline labels when wide enough", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} width={120} />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows tooltip on hover when narrow (icon-only mode)", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} width={56} />);
    const link = screen.getByLabelText("Dashboard");
    fireEvent.mouseEnter(link);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Dashboard");
  });

  it("tooltip has aria-describedby on the hovered link in narrow mode", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} width={56} />);
    const link = screen.getByLabelText("Dashboard");
    fireEvent.mouseEnter(link);
    expect(link).toHaveAttribute("aria-describedby", "nav-tooltip-home");
  });

  it("hides tooltip on mouse leave and clears aria-describedby", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} width={56} />);
    const link = screen.getByLabelText("Dashboard");
    fireEvent.mouseEnter(link);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.mouseLeave(link);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(link).not.toHaveAttribute("aria-describedby");
  });

  it("has proper aria-label on nav", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} />);
    expect(screen.getByRole("navigation", { name: "Collapsed navigation" })).toBeInTheDocument();
  });

  it("filters nav items by permission", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} />, { role: "worker" });
    expect(screen.queryByLabelText("Users")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Dashboard")).toBeInTheDocument();
    expect(screen.getByLabelText("Products")).toBeInTheDocument();
  });

  it("hides the admin group for non-admin roles", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} />, { role: "worker" });
    expect(screen.queryByLabelText("Settings")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Reports")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Activity")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Notifications")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Products")).toBeInTheDocument();
  });

  it("shows the admin group for admin role", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} />, { role: "admin" });
    expect(screen.getByLabelText("Settings")).toBeInTheDocument();
    expect(screen.getByLabelText("Users")).toBeInTheDocument();
  });

  it("renders expand button and calls onExpand", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} />);
    const btn = screen.getByRole("button", { name: "Expand sidebar" });
    fireEvent.click(btn);
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("renders user avatar initial", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} />);
    expect(screen.getByText("T")).toBeInTheDocument();
  });

  it("renders logout button", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} />);
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("applies dynamic width via inline style", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} width={96} />);
    const nav = screen.getByRole("navigation", { name: "Collapsed navigation" });
    expect(nav).toHaveStyle({ width: "96px" });
  });

  it("renders resize handle", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} />);
    expect(screen.getByRole("separator", { name: "Resize collapsed sidebar" })).toBeInTheDocument();
  });

  it("calls onWidthChange when resize handle is dragged", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} width={72} />);
    const handle = screen.getByRole("separator", { name: "Resize collapsed sidebar" });
    fireEvent.pointerDown(handle, { clientX: 72 });
    fireEvent.pointerMove(window, { clientX: 102 });
    fireEvent.pointerUp(window);
    expect(onWidthChange).toHaveBeenCalled();
  });

  it("bottom section has no text labels at any width", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} width={200} />);
    const expandBtn = screen.getByRole("button", { name: "Expand sidebar" });
    expect(expandBtn).toHaveClass("w-9", "h-9");
    expect(screen.getByRole("button", { name: "Log out" })).toHaveClass("w-9", "h-9");
  });

  it("bottom section always uses icon-only layout", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} width={140} />);
    const expandBtn = screen.getByRole("button", { name: "Expand sidebar" });
    expect(expandBtn).toHaveClass("w-9", "h-9");
    expect(screen.getByRole("button", { name: "Log out" })).toHaveClass("w-9", "h-9");
    const profileLinks = screen.getAllByLabelText("Profile");
    const bottomProfile = profileLinks[profileLinks.length - 1];
    expect(bottomProfile).toHaveClass("w-9", "h-9");
  });

  it("renders backdrop in overlay mode", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} overlay />);
    const backdrop = document.querySelector('[aria-hidden="true"].animate-fade-in');
    expect(backdrop).toBeInTheDocument();
  });

  it("does not render backdrop in non-overlay mode", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} />);
    const backdrop = document.querySelector('[aria-hidden="true"].animate-fade-in');
    expect(backdrop).not.toBeInTheDocument();
  });

  it("calls onClose when backdrop is clicked in overlay mode", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} overlay />);
    const backdrop = document.querySelector('[aria-hidden="true"].animate-fade-in') as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape key in overlay mode", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} overlay />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose on Escape key in non-overlay mode", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose when nav item clicked in overlay mode", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} overlay />, { route: "/" });
    const link = screen.getByLabelText("Products");
    fireEvent.click(link);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not call onClose when nav item clicked in non-overlay mode", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} />, { route: "/" });
    const link = screen.getByLabelText("Products");
    fireEvent.click(link);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows group headers in label mode", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} width={120} />);
    const headers = document.querySelectorAll("button[aria-expanded]");
    const headerTexts = Array.from(headers).map((h) => h.textContent?.trim());
    expect(headerTexts).toContain("Overview");
    expect(headerTexts).toContain("Inventory");
    expect(headerTexts).toContain("Sales");
    expect(headerTexts).toContain("Admin");
  });

  it("does not show group headers in icon-only mode", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} width={56} />);
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
    expect(screen.queryByText("Inventory")).not.toBeInTheDocument();
  });

  it("collapses group on header click and hides items", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} width={120} />);
    expect(screen.getByLabelText("Products")).toBeInTheDocument();
    const inventoryHeader = screen.getByText("Inventory").closest("button")!;
    fireEvent.click(inventoryHeader);
    expect(screen.queryByLabelText("Products")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Categories")).not.toBeInTheDocument();
  });

  it("expands collapsed group on second header click", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} width={120} />);
    const header = screen.getByText("Inventory").closest("button")!;
    fireEvent.click(header);
    expect(screen.queryByLabelText("Products")).not.toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.getByLabelText("Products")).toBeInTheDocument();
  });

  it("persists collapsed groups to localStorage", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} width={120} />);
    const header = screen.getByText("Inventory").closest("button")!;
    fireEvent.click(header);
    const saved = JSON.parse(localStorage.getItem("collapsedNavGroups")!);
    expect(saved).toContain("inventory");
  });

  it("restores collapsed groups from localStorage", () => {
    localStorage.setItem("collapsedNavGroups", JSON.stringify(["inventory"]));
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} width={120} />);
    expect(screen.queryByLabelText("Products")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Dashboard")).toBeInTheDocument();
  });

  it("highlights active group header", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} width={120} />, { route: "/products" });
    const headers = document.querySelectorAll("button[aria-expanded]");
    const inventoryHeader = Array.from(headers).find((h) => h.textContent?.trim() === "Inventory");
    expect(inventoryHeader).toBeTruthy();
    expect(inventoryHeader!.querySelector(".text-indigo-500")).toBeInTheDocument();
  });

  it("does not highlight inactive group header", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} width={120} />, { route: "/products" });
    const headers = document.querySelectorAll("button[aria-expanded]");
    const salesHeader = Array.from(headers).find((h) => h.textContent?.trim() === "Sales");
    expect(salesHeader).toBeTruthy();
    expect(salesHeader!.querySelector(".text-indigo-500")).not.toBeInTheDocument();
  });

  it("aria-expanded is false on collapsed group header", () => {
    renderWithProviders(<FloatingSidebar {...defaultWidthProps} width={120} />);
    const header = screen.getByText("Inventory").closest("button")!;
    expect(header).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
  });
});
