import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import Profile from "../pages/Profile";

const getMock = api.get as ReturnType<typeof vi.fn>;
const postMock = api.post as ReturnType<typeof vi.fn>;
const putMock = api.put as ReturnType<typeof vi.fn>;
const deleteMock = api.delete as ReturnType<typeof vi.fn>;

describe("Profile Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    getMock.mockImplementation((url: string) => {
      if (url === "/auth/sessions") {
        return Promise.resolve({ data: [
          { id: 1, ip_address: "127.0.0.1", user_agent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0", created_at: "2026-01-01T00:00:00", last_seen_at: "2026-01-02T00:00:00", revoked_at: null, is_current: true },
          { id: 2, ip_address: "10.0.0.5", user_agent: "Mozilla/5.0 (iPhone) Safari/17.0", created_at: "2026-01-03T00:00:00", last_seen_at: "2026-01-03T12:00:00", revoked_at: null, is_current: false },
        ] });
      }
      if (url === "/activity-logs") {
        return Promise.resolve({ data: { items: [{ id: 1, user_id: 1, action: "update", entity_type: "product", description: "Updated product", created_at: "2026-01-01T00:00:00" }], total: 1 } });
      }
      return Promise.resolve({ data: {} });
    });
  });

  it("renders account info and active sessions", async () => {
    renderWithProviders(<Profile />);
    expect(await screen.findByText("tester@example.com")).toBeInTheDocument();
    expect(screen.getByText("Chrome")).toBeInTheDocument();
    expect(screen.getByText("Safari")).toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Upload Avatar/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign Out Other Devices/ })).toBeInTheDocument();
  });

  it("saves profile edits through the API", async () => {
    putMock.mockResolvedValue({ data: { username: "tester", email: "new@example.com", role: "admin" } });
    renderWithProviders(<Profile />);
    const emailInput = await screen.findByDisplayValue("tester@example.com");
    fireEvent.change(emailInput, { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/ }));
    await waitFor(() => expect(putMock).toHaveBeenCalledWith("/auth/me", expect.objectContaining({ email: "new@example.com" })));
  });

  it("exports my data", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/auth/sessions") return Promise.resolve({ data: [] });
      if (url === "/activity-logs") return Promise.resolve({ data: { items: [] } });
      if (url === "/auth/me/export") return Promise.resolve({ data: { profile: { username: "tester" } } });
      return Promise.resolve({ data: {} });
    });
    renderWithProviders(<Profile />);
    fireEvent.click(await screen.findByRole("button", { name: /Export My Data/ }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith("/auth/me/export"));
  });

  it("revokes another session", async () => {
    deleteMock.mockResolvedValue({ data: {} });
    renderWithProviders(<Profile />);
    const revokeButtons = await screen.findAllByRole("button", { name: "Revoke" });
    fireEvent.click(revokeButtons[0]);
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("/auth/sessions/2"));
  });

  it("signs the user out after changing the password", async () => {
    putMock.mockResolvedValue({ data: { ok: true } });
    postMock.mockResolvedValue({ data: { ok: true } });
    renderWithProviders(<Profile />);
    const submit = await screen.findByRole("button", { name: /Change Password/ });
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="password"]');
    fireEvent.change(inputs[0], { target: { value: "oldpass1" } });
    fireEvent.change(inputs[1], { target: { value: "newpass123" } });
    fireEvent.click(submit);
    await waitFor(() => expect(putMock).toHaveBeenCalledWith("/users/password/change", {
      current_password: "oldpass1",
      new_password: "newpass123",
    }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/auth/logout"));
    await waitFor(() => expect(localStorage.getItem("token")).toBeNull());
    await waitFor(() => expect(document.querySelectorAll('input[type="password"]').length).toBe(0));
  });
});
