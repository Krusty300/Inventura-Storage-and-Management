import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import Settings from "../pages/Settings";

const getMock = api.get as ReturnType<typeof vi.fn>;
const putMock = api.put as ReturnType<typeof vi.fn>;

const settings = {
  store_name: "My Store",
  address: "42 Main St",
  phone: "555-0199",
  email: "store@example.com",
  currency_symbol: "€",
  tax_rate: 10,
  default_reorder_level: 5,
};

describe("Settings Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("loads settings into the form before enabling save", async () => {
    getMock.mockResolvedValue({ data: settings });
    putMock.mockResolvedValue({ data: {} });
    renderWithProviders(<Settings />);
    expect(await screen.findByDisplayValue("My Store")).toBeInTheDocument();
    expect(screen.getByDisplayValue("€")).toBeInTheDocument();
    const saveButton = await screen.findByRole("button", { name: "Save Settings" });
    expect(saveButton).not.toBeDisabled();
    fireEvent.change(screen.getByDisplayValue("555-0199"), { target: { value: "555-0000" } });
    fireEvent.click(saveButton);
    await vi.waitFor(() => expect(putMock).toHaveBeenCalledWith("/settings", expect.objectContaining({ store_name: "My Store", currency_symbol: "€", phone: "555-0000" })));
  });

  it("shows settings read-only for workers", async () => {
    getMock.mockResolvedValue({ data: settings });
    renderWithProviders(<Settings />, { role: "worker" });
    expect(await screen.findByText("Store Information")).toBeInTheDocument();
    expect(screen.getByDisplayValue("My Store")).toBeDisabled();
    expect(screen.getByDisplayValue("€")).toBeDisabled();
    expect(screen.getByDisplayValue("555-0199")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save Settings" })).not.toBeInTheDocument();
    expect(screen.getByText(/read-only access/)).toBeInTheDocument();
  });
});
