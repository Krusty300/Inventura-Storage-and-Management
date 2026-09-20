import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "../context/AuthContext";
import { ThemeProvider } from "../context/ThemeContext";
import { FontSizeProvider } from "../context/FontSizeContext";
import { ToastProvider } from "../context/ToastContext";
import CommandPalette from "../components/CommandPalette";

vi.mock("../api/client", () => ({
  default: {
    get: vi.fn(() => {
      const stored = localStorage.getItem("user");
      return Promise.resolve({ data: stored ? JSON.parse(stored) : { id: 1, username: "tester", email: "tester@example.com", role: "admin" } });
    }),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const queryClient = new QueryClient();

function renderPalette(role: string) {
  localStorage.setItem("token", "test-token");
  localStorage.setItem("user", JSON.stringify({ id: 1, username: "tester", email: "tester@example.com", role }));
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/portal"]}>
        <ThemeProvider>
          <FontSizeProvider>
            <ToastProvider>
              <AuthProvider>
                <CommandPalette portal />
              </AuthProvider>
            </ToastProvider>
          </FontSizeProvider>
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function openPalette() {
  await act(async () => {
    window.dispatchEvent(new CustomEvent("open-command-palette"));
  });
}

describe("CommandPalette portal mode", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("shows supplier portal commands for a supplier", async () => {
    renderPalette("supplier");
    await openPalette();
    expect(screen.getByText("Purchase Orders")).toBeInTheDocument();
    expect(screen.getByText("Shipments")).toBeInTheDocument();
    expect(screen.getByText("Deliveries")).toBeInTheDocument();
    expect(screen.queryByText("Catalog")).not.toBeInTheDocument();
    expect(screen.queryByText("Invoices")).not.toBeInTheDocument();
  });

  it("shows customer portal commands for a customer", async () => {
    renderPalette("customer");
    await openPalette();
    expect(screen.getByText("Catalog")).toBeInTheDocument();
    expect(screen.getByText("Invoices")).toBeInTheDocument();
    expect(screen.queryByText("Purchase Orders")).not.toBeInTheDocument();
    expect(screen.queryByText("Shipments")).not.toBeInTheDocument();
    expect(screen.queryByText("Deliveries")).not.toBeInTheDocument();
  });
});