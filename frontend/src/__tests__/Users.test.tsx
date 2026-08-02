import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import Users from "../pages/Users";

const getMock = api.get as ReturnType<typeof vi.fn>;
const putMock = api.put as ReturnType<typeof vi.fn>;
const postMock = api.post as ReturnType<typeof vi.fn>;
const deleteMock = api.delete as ReturnType<typeof vi.fn>;

function mockUsers(items: Record<string, unknown>[]) {
  getMock.mockImplementation((url: string) => {
    if (url === "/users") return Promise.resolve({ data: { items, total: items.length, page: 1, pages: 1 } });
    return Promise.reject(new Error(`Unexpected call: ${url}`));
  });
}

describe("Users Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders user rows with username, email and role", async () => {
    mockUsers([{ id: 2, username: "alice", email: "alice@example.com", role: "worker", last_login_at: "2026-02-01T00:00:00", created_at: "2026-01-01T00:00:00" }]);
    renderWithProviders(<Users />);
    expect(await screen.findByText("alice")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("worker")).toBeInTheDocument();
  });

  it("confirms a role change before saving", async () => {
    mockUsers([{ id: 2, username: "alice", email: "alice@example.com", role: "worker", last_login_at: "2026-02-01T00:00:00", created_at: "2026-01-01T00:00:00" }]);
    putMock.mockResolvedValue({ data: {} });
    renderWithProviders(<Users />);
    fireEvent.click(await screen.findByText("Edit"));
    fireEvent.change(screen.getByLabelText("Edit role for alice"), { target: { value: "admin" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("dialog", { name: "Confirm Role Change" })).toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: "Confirm Role Change" })).getByText(/Change "alice"'s role from worker to admin/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await vi.waitFor(() => expect(putMock).toHaveBeenCalledWith("/users/2", { role: "admin" }));
  });

  it("creates a user through the Add User modal", async () => {
    mockUsers([{ id: 2, username: "alice", email: "alice@example.com", role: "worker", last_login_at: "2026-02-01T00:00:00", created_at: "2026-01-01T00:00:00" }]);
    postMock.mockResolvedValue({ data: {} });
    renderWithProviders(<Users />);
    fireEvent.click(screen.getByRole("button", { name: /Add User/i }));
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "bob" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "bob@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "testpass123" } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "worker" } });
    fireEvent.click(screen.getByRole("button", { name: "Create User" }));
    await vi.waitFor(() => expect(postMock).toHaveBeenCalledWith("/users", {
      username: "bob", email: "bob@example.com", password: "testpass123", role: "worker",
    }));
  });

  it("resets a user's password through the reset modal", async () => {
    mockUsers([{ id: 2, username: "alice", email: "alice@example.com", role: "worker", last_login_at: "2026-02-01T00:00:00", created_at: "2026-01-01T00:00:00" }]);
    postMock.mockResolvedValue({ data: {} });
    renderWithProviders(<Users />);
    fireEvent.click(await screen.findByLabelText("Reset password for alice"));
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "newpass123" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset Password" }));
    await vi.waitFor(() => expect(postMock).toHaveBeenCalledWith("/users/2/reset-password", { new_password: "newpass123" }));
  });

  it("deactivates a user through the confirm dialog", async () => {
    mockUsers([{ id: 2, username: "alice", email: "alice@example.com", role: "worker", last_login_at: "2026-02-01T00:00:00", created_at: "2026-01-01T00:00:00" }]);
    deleteMock.mockResolvedValue({ data: {} });
    renderWithProviders(<Users />);
    fireEvent.click(await screen.findByLabelText("Deactivate alice"));
    expect(screen.getByRole("dialog", { name: "Deactivate User" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    await vi.waitFor(() => expect(deleteMock).toHaveBeenCalledWith("/users/2"));
  });

  it("shows the backend detail when a role change is rejected", async () => {
    mockUsers([{ id: 2, username: "alice", email: "alice@example.com", role: "admin", created_at: "2026-01-01T00:00:00" }]);
    putMock.mockRejectedValue({ response: { data: { detail: "Cannot demote the last admin" } } });
    renderWithProviders(<Users />);
    fireEvent.click(await screen.findByText("Edit"));
    fireEvent.change(screen.getByLabelText("Edit role for alice"), { target: { value: "worker" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Cannot demote the last admin")).toBeInTheDocument();
  });

  it("marks the current user and locks self-edit and self-delete", async () => {
    mockUsers([{ id: 1, username: "tester", email: "tester@example.com", role: "admin", last_login_at: "2026-02-01T00:00:00", created_at: "2026-01-01T00:00:00" }]);
    renderWithProviders(<Users />);
    expect(await screen.findByText("tester")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Deactivate tester")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Reset password for tester")).toBeInTheDocument();
  });

  it("renders export button and pagination controls", async () => {
    mockUsers([{ id: 2, username: "alice", email: "alice@example.com", role: "worker", last_login_at: null, created_at: "2026-01-01T00:00:00" }]);
    renderWithProviders(<Users />);
    expect(await screen.findByText("alice")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export users to CSV/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Page size")).toBeInTheDocument();
  });

  it("sorts by clicking a column header", async () => {
    mockUsers([{ id: 2, username: "alice", email: "alice@example.com", role: "worker", last_login_at: null, created_at: "2026-01-01T00:00:00" }]);
    renderWithProviders(<Users />);
    fireEvent.click(await screen.findByLabelText("Sort by email"));
    await vi.waitFor(() => expect(getMock).toHaveBeenCalledWith("/users", expect.objectContaining({ params: expect.objectContaining({ sort_by: "email", sort_dir: "asc" }) })));
  });

  it("shows per-user activity in the detail modal", async () => {
    mockUsers([{ id: 2, username: "alice", email: "alice@example.com", role: "worker", last_login_at: null, created_at: "2026-01-01T00:00:00" }]);
    getMock.mockImplementation((url: string) => {
      if (url === "/users") return Promise.resolve({ data: { items: [{ id: 2, username: "alice", email: "alice@example.com", role: "worker", last_login_at: null, created_at: "2026-01-01T00:00:00" }], total: 1, page: 1, pages: 1 } });
      if (url === "/activity-logs") return Promise.resolve({ data: { items: [{ id: 9, user_id: 1, username: "tester", action: "update", entity_type: "user", entity_id: 2, description: "Updated user 'alice' (role=admin)", details: "", created_at: "2026-01-02T00:00:00" }], total: 1, page: 1, pages: 1 } });
      return Promise.reject(new Error(`Unexpected call: ${url}`));
    });
    renderWithProviders(<Users />);
    fireEvent.click(await screen.findByLabelText("View alice"));
    expect(await screen.findByText("Recent Activity")).toBeInTheDocument();
    expect(await screen.findByText(/Updated user 'alice'/)).toBeInTheDocument();
  });
});
