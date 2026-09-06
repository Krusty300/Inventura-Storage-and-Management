import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Layout from "../components/Layout";
import { AuthProvider } from "../context/AuthContext";
import { ThemeProvider } from "../context/ThemeContext";
import { ToastProvider } from "../context/ToastContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

const TABLET_MQ = "(min-width: 768px)";
const DESKTOP_MQ = "(min-width: 1024px)";
let tabletMatches = false;
let desktopMatches = false;

function mockMatchMedia() {
  window.matchMedia = ((query: string) => ({
    matches: query === TABLET_MQ ? tabletMatches : query === DESKTOP_MQ ? desktopMatches : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

function renderLayout() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>
              <Layout />
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Layout", () => {
  beforeEach(() => {
    tabletMatches = false;
    desktopMatches = false;
    mockMatchMedia();
    localStorage.setItem("token", "test-token");
    localStorage.setItem("user", JSON.stringify({ id: 1, username: "tester", email: "tester@example.com", role: "admin" }));
  });

  afterEach(() => {
    localStorage.removeItem("sidebarCollapsed");
    localStorage.removeItem("floatingSidebarWidth");
    localStorage.removeItem("collapsedNavGroups");
  });

  it("renders app name", () => {
    renderLayout();
    expect(screen.getByText("Inventura Storage")).toBeInTheDocument();
  });

  it("renders all navigation links", () => {
    renderLayout();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Products")).toBeInTheDocument();
    expect(screen.getByText("Categories")).toBeInTheDocument();
    expect(screen.getByText("Suppliers")).toBeInTheDocument();
    expect(screen.getByText("Movements")).toBeInTheDocument();
    expect(screen.getByText("Orders")).toBeInTheDocument();
    expect(screen.getByText("Locations")).toBeInTheDocument();
    expect(screen.getByText("Receiving")).toBeInTheDocument();
    expect(screen.getByText("LPNs")).toBeInTheDocument();
  });

  it("renders a collapse toggle on desktop", () => {
    tabletMatches = true;
    renderLayout();
    expect(screen.getByTitle("Collapse sidebar")).toBeInTheDocument();
  });

  it("collapses the sidebar on desktop for full page visibility", () => {
    tabletMatches = true;
    desktopMatches = true;
    renderLayout();
    fireEvent.click(screen.getByTitle("Collapse sidebar"));
    const aside = document.querySelector("aside");
    expect(aside).toHaveAttribute("aria-hidden", "true");
    expect(aside).toHaveStyle("width: 0px");
    expect(aside).toHaveClass("md:invisible");
    expect(localStorage.getItem("sidebarCollapsed")).toBe("1");
    expect(screen.getByTitle("Expand sidebar")).toBeInTheDocument();
  });

  it("shows the floating sidebar when collapsed on desktop", () => {
    tabletMatches = true;
    desktopMatches = true;
    renderLayout();
    fireEvent.click(screen.getByTitle("Collapse sidebar"));
    expect(screen.getByRole("navigation", { name: "Collapsed navigation" })).toBeInTheDocument();
  });

  it("hides the floating sidebar when expanded on desktop", () => {
    tabletMatches = true;
    desktopMatches = true;
    renderLayout();
    expect(screen.queryByRole("navigation", { name: "Collapsed navigation" })).not.toBeInTheDocument();
  });

  it("does not show the floating sidebar on mobile", () => {
    localStorage.setItem("sidebarCollapsed", "1");
    renderLayout();
    expect(screen.queryByRole("navigation", { name: "Collapsed navigation" })).not.toBeInTheDocument();
  });

  it("shifts main content with inline margin when collapsed on desktop", () => {
    tabletMatches = true;
    desktopMatches = true;
    renderLayout();
    fireEvent.click(screen.getByTitle("Collapse sidebar"));
    const mainContent = document.querySelector("#main-content")?.parentElement;
    expect(mainContent).toHaveStyle({ marginLeft: 72 });
  });

  it("does not shift main content in overlay mode on tablet", () => {
    tabletMatches = true;
    desktopMatches = false;
    renderLayout();
    fireEvent.click(screen.getByTitle("Collapse sidebar"));
    const mainContent = document.querySelector("#main-content")?.parentElement;
    expect(mainContent?.getAttribute("style")).toBeFalsy();
  });

  it("renders backdrop in overlay mode on tablet when collapsed", () => {
    tabletMatches = true;
    desktopMatches = false;
    renderLayout();
    fireEvent.click(screen.getByTitle("Collapse sidebar"));
    const backdrop = document.querySelector('[aria-hidden="true"].animate-fade-in');
    expect(backdrop).toBeInTheDocument();
  });

  it("restores floating sidebar width from localStorage", () => {
    tabletMatches = true;
    desktopMatches = true;
    localStorage.setItem("sidebarCollapsed", "1");
    localStorage.setItem("floatingSidebarWidth", "120");
    renderLayout();
    const nav = screen.getByRole("navigation", { name: "Collapsed navigation" });
    expect(nav).toHaveStyle({ width: "120px" });
    localStorage.removeItem("floatingSidebarWidth");
  });

  it("toggles sidebar with Ctrl+B keyboard shortcut", () => {
    tabletMatches = true;
    desktopMatches = true;
    renderLayout();
    expect(screen.queryByRole("navigation", { name: "Collapsed navigation" })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(screen.getByRole("navigation", { name: "Collapsed navigation" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(screen.queryByRole("navigation", { name: "Collapsed navigation" })).not.toBeInTheDocument();
  });

  it("dispatches open-global-search on Ctrl+K", () => {
    const handler = vi.fn();
    window.addEventListener("open-global-search", handler);
    renderLayout();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener("open-global-search", handler);
  });

  it("expands the sidebar back after collapsing", () => {
    tabletMatches = true;
    desktopMatches = true;
    renderLayout();
    fireEvent.click(screen.getByTitle("Collapse sidebar"));
    fireEvent.click(screen.getByTitle("Expand sidebar"));
    const aside = document.querySelector("aside");
    expect(aside).not.toHaveAttribute("aria-hidden");
    expect(localStorage.getItem("sidebarCollapsed")).toBe("0");
    expect(screen.getByTitle("Collapse sidebar")).toBeInTheDocument();
  });

  it("restores collapsed state from localStorage", () => {
    tabletMatches = true;
    desktopMatches = true;
    localStorage.setItem("sidebarCollapsed", "1");
    renderLayout();
    const aside = document.querySelector("aside");
    expect(aside).toHaveAttribute("aria-hidden", "true");
    expect(aside).toHaveStyle("width: 0px");
    expect(screen.getByTitle("Expand sidebar")).toBeInTheDocument();
  });

  it("keeps the sidebar expanded when collapsed flag is set on mobile", () => {
    localStorage.setItem("sidebarCollapsed", "1");
    renderLayout();
    const aside = document.querySelector("aside");
    expect(aside).not.toHaveAttribute("aria-hidden");
    expect(aside).not.toHaveStyle("width: 0px");
  });

  it("hides admin-only nav items for default workers", () => {
    localStorage.setItem("user", JSON.stringify({ id: 1, username: "worker", email: "w@example.com", role: "worker" }));
    renderLayout();
    expect(screen.getByText("Products")).toBeInTheDocument();
    expect(screen.queryByText("Users")).not.toBeInTheDocument();
    expect(screen.queryByText("Reports")).not.toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("limits nav to a worker's custom permission allowlist", () => {
    localStorage.setItem("user", JSON.stringify({ id: 1, username: "worker", email: "w@example.com", role: "worker", permissions: ["products.view"] }));
    renderLayout();
    expect(screen.getByText("Products")).toBeInTheDocument();
    expect(screen.queryByText("Reports")).not.toBeInTheDocument();
    expect(screen.queryByText("Orders")).not.toBeInTheDocument();
    expect(screen.queryByText("Users")).not.toBeInTheDocument();
  });
});
