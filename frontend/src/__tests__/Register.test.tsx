import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import Register from "../pages/Register";
import { AuthProvider } from "../context/AuthContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

function renderRegister() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthProvider>
          <Register />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Register Page", () => {
  it("renders create account heading", () => {
    renderRegister();
    expect(screen.getByRole("heading", { name: /create account/i })).toBeInTheDocument();
  });

  it("renders input labels", () => {
    renderRegister();
    expect(screen.getByText("Username")).toBeInTheDocument();
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("Password")).toBeInTheDocument();
  });

  it("renders register button", () => {
    renderRegister();
    expect(screen.getByRole("button", { name: /register/i })).toBeInTheDocument();
  });

  it("renders sign in link", () => {
    renderRegister();
    expect(screen.getByText(/already have an account/i)).toBeInTheDocument();
  });
});
