import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RequirePermission from "../components/RequirePermission";
import { AuthProvider } from "../context/AuthContext";
import { ThemeProvider } from "../context/ThemeContext";
import { ToastProvider } from "../context/ToastContext";

function renderGuarded(role: string, permissions: string[] | null) {
  localStorage.setItem("token", "test-token");
  localStorage.setItem("user", JSON.stringify({ id: 1, username: "tester", email: "tester@example.com", role, permissions }));
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/users"]}>
        <ThemeProvider>
          <AuthProvider>
            <ToastProvider>
              <RequirePermission perm="users.view">
                <div>Secret page content</div>
              </RequirePermission>
            </ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("RequirePermission", () => {
  beforeEach(() => localStorage.clear());

  it("renders children when the user has the permission", () => {
    renderGuarded("admin", null);
    expect(screen.getByText("Secret page content")).toBeInTheDocument();
    expect(screen.queryByText("Access denied")).not.toBeInTheDocument();
  });

  it("renders children when the permission is on the worker allowlist", () => {
    renderGuarded("worker", ["users.view"]);
    expect(screen.getByText("Secret page content")).toBeInTheDocument();
  });

  it("blocks a default worker without the permission", () => {
    renderGuarded("worker", null);
    expect(screen.getByText("Access denied")).toBeInTheDocument();
    expect(screen.queryByText("Secret page content")).not.toBeInTheDocument();
  });

  it("blocks a worker whose allowlist omits the permission", () => {
    renderGuarded("worker", ["products.view"]);
    expect(screen.getByText("Access denied")).toBeInTheDocument();
    expect(screen.queryByText("Secret page content")).not.toBeInTheDocument();
  });
});
