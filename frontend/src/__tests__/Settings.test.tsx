import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
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
  currency_symbol: "KSh",
  currency_code: "KES",
  tax_rate: 10,
  default_reorder_level: 5,
  expiry_warning_days: 30,
  low_stock_alerts: true,
  expiry_alerts: true,
  shipment_prefix: "SHP",
  work_order_prefix: "WO",
  invoice_prefix: "INV",
  po_prefix: "PO",
  receipt_prefix: "RCP",
  asn_prefix: "ASN",
  qc_prefix: "QC",
  cc_prefix: "CC",
  return_prefix: "RET",
  transfer_prefix: "TRF",
  unallocated_prefix: "UNL",
  quarantine_prefix: "QAR",
  lpn_prefix: "LPN",
  lpn_move_prefix: "MOV",
  lpn_load_prefix: "LOD",
  lpn_unload_prefix: "ULD",
  stock_in_prefix: "SI",
  stock_out_prefix: "SO",
  adjustment_prefix: "ADJ",
  require_qc_before_ship: false,
  auto_allocate_stock: false,
  enforce_fefo: false,
  default_costing_method: "weighted_average",
  fiscal_year_start_month: 1,
  default_items_per_page: 50,
  date_format: "YYYY-MM-DD",
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
    const saveButton = await screen.findByRole("button", { name: "Save Settings" });
    expect(saveButton).not.toBeDisabled();
    fireEvent.change(screen.getByDisplayValue("555-0199"), { target: { value: "555-0000" } });
    fireEvent.click(saveButton);
    await vi.waitFor(() => expect(putMock).toHaveBeenCalledWith("/settings", expect.objectContaining({ store_name: "My Store", phone: "555-0000" })));
  });

  it("shows the currency dropdown with the current currency code selected", async () => {
    getMock.mockResolvedValue({ data: settings });
    renderWithProviders(<Settings />);
    await screen.findByDisplayValue("My Store");
    await waitFor(() => {
      const selects = document.querySelectorAll("select");
      const currencySelect = Array.from(selects).find((s) => s.value === "KES");
      expect(currencySelect).toBeDefined();
    });
  });

  it("updates currency symbol when currency code changes", async () => {
    getMock.mockResolvedValue({ data: settings });
    putMock.mockResolvedValue({ data: {} });
    renderWithProviders(<Settings />);
    await screen.findByDisplayValue("My Store");
    await waitFor(() => {
      const selects = document.querySelectorAll("select");
      const currencySelect = Array.from(selects).find((s) => s.value === "KES");
      expect(currencySelect).toBeDefined();
    });
    const selects = document.querySelectorAll("select");
    const currencySelect = Array.from(selects).find((s) => s.value === "KES")!;
    fireEvent.change(currencySelect, { target: { value: "USD" } });
    fireEvent.click(await screen.findByRole("button", { name: "Save Settings" }));
    await vi.waitFor(() => expect(putMock).toHaveBeenCalledWith("/settings", expect.objectContaining({
      currency_code: "USD",
      currency_symbol: "$",
    })));
  });

  it("shows settings read-only for workers", async () => {
    getMock.mockResolvedValue({ data: settings });
    renderWithProviders(<Settings />, { role: "worker" });
    expect(await screen.findByText("Store Information")).toBeInTheDocument();
    expect(screen.getByDisplayValue("My Store")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save Settings" })).not.toBeInTheDocument();
    expect(screen.getByText(/read-only access/)).toBeInTheDocument();
  });
});
