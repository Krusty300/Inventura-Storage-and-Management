import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Layout from "../components/Layout";
import { AuthProvider } from "../context/AuthContext";
import { ThemeProvider } from "../context/ThemeContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

const DESKTOP_MQ = "(min-width: 1024px)";
let desktopMatches = false;

function mockMatchMedia() {
  window.matchMedia = ((query: string) => ({
    matches: query === DESKTOP_MQ ? desktopMatches : false,
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
          <AuthProvider>
            <Layout />
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Layout", () => {
  beforeEach(() => {
    desktopMatches = false;
    mockMatchMedia();
    localStorage.setItem("token", "test-token");
    localStorage.setItem("user", JSON.stringify({ id: 1, username: "tester", email: "tester@example.com", role: "admin" }));
  });

  afterEach(() => {
    localStorage.removeItem("sidebarCollapsed");
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
    desktopMatches = true;
    renderLayout();
    expect(screen.getByTitle("Collapse sidebar")).toBeInTheDocument();
  });

  it("collapses the sidebar on desktop for full page visibility", () => {
    desktopMatches = true;
    renderLayout();
    fireEvent.click(screen.getByTitle("Collapse sidebar"));
    const aside = document.querySelector("aside");
    expect(aside).toHaveAttribute("aria-hidden", "true");
    expect(aside).toHaveStyle("width: 0px");
    expect(aside).toHaveClass("lg:invisible");
    expect(localStorage.getItem("sidebarCollapsed")).toBe("1");
    expect(screen.getByTitle("Expand sidebar")).toBeInTheDocument();
  });

  it("expands the sidebar back after collapsing", () => {
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
    expect(screen.getByText("Reports")).toBeInTheDocument();
    expect(screen.queryByText("Users")).not.toBeInTheDocument();
  });

  it("limits nav to a worker's custom permission allowlist", () => {
    localStorage.setItem("user", JSON.stringify({ id: 1, username: "worker", email: "w@example.com", role: "worker", permissions: ["products.view"] }));
    renderLayout();
    expect(screen.getByText("Products")).toBeInTheDocument();
    expect(screen.queryByText("Reports")).not.toBeInTheDocument();
    expect(screen.queryByText("Orders")).not.toBeInTheDocument();
    expect(screen.queryByText("Users")).not.toBeInTheDocument();
    expect(screen.getByText("Profile")).toBeInTheDocument();
  });
});
