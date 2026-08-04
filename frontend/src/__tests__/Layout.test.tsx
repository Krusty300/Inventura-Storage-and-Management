import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import Layout from "../components/Layout";
import { AuthProvider } from "../context/AuthContext";
import { ThemeProvider } from "../context/ThemeContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

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
    localStorage.setItem("token", "test-token");
    localStorage.setItem("user", JSON.stringify({ id: 1, username: "tester", email: "tester@example.com", role: "admin" }));
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
});
