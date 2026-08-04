import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import Login from "../pages/Login";
import { AuthProvider } from "../context/AuthContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

function renderLogin() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthProvider>
          <Login />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Login Page", () => {
  it("renders sign in heading", () => {
    renderLogin();
    expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
  });

  it("renders username label", () => {
    renderLogin();
    expect(screen.getByText("Username")).toBeInTheDocument();
  });

  it("renders password label", () => {
    renderLogin();
    expect(screen.getByText("Password")).toBeInTheDocument();
  });

  it("renders submit button", () => {
    renderLogin();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("renders register link", () => {
    renderLogin();
    expect(screen.getByText(/don't have an account/i)).toBeInTheDocument();
  });

  it("toggles password visibility", () => {
    renderLogin();
    const toggle = screen.getByRole("button", { name: /show password/i });
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    fireEvent.click(toggle);
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
  });

  it("renders remember me checkbox", () => {
    renderLogin();
    expect(screen.getByRole("checkbox", { name: /remember me/i })).toBeInTheDocument();
  });
});
