import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AuthProvider } from "../context/AuthContext";
import { ToastProvider } from "../context/ToastContext";
import { MONTHS } from "../utils/calendar";
import type { Product } from "../types";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}

export function renderWithProviders(
  ui: ReactNode,
  { queryClient = makeQueryClient(), route = "/", role = "admin" }: { queryClient?: QueryClient; route?: string; role?: string } = {}
) {
  localStorage.setItem("token", "test-token");
  localStorage.setItem("user", JSON.stringify({ id: 1, username: "tester", email: "tester@example.com", role }));
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          <ToastProvider>{ui}</ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

let productId = 0;

export function makeProduct(overrides: Partial<Product> = {}): Product {
  productId += 1;
  const id = overrides.id ?? productId;
  const name = overrides.name ?? `Product ${id}`;
  return {
    id,
    sku: overrides.sku ?? `SKU-${id}`,
    name,
    description: "",
    category_id: null,
    supplier_id: null,
    parent_id: null,
    attributes: null,
    unit_price: 10,
    cost_price: 5,
    quantity: 20,
    reorder_level: 10,
    location_id: null,
    location: "A1",
    barcode: "",
    batch_number: "",
    expiry_date: null,
    effective_expiry_date: null,
    image_url: "",
    is_active: true,
    is_serialized: false,
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
    category_name: "",
    supplier_name: "",
    is_variant: false,
    variant_of_name: "",
    variant_label: "",
    display_name: name,
    total_quantity: 20,
    quarantined_qty: 0,
    expired_lot_qty: 0,
    sellable_qty: 20,
    reserved_qty: 0,
    images: [],
    variants: [],
    ...overrides,
  };
}

export function makeVariant(parent: Product, overrides: Partial<Product> = {}): Product {
  return makeProduct({
    name: `${parent.name} variant`,
    display_name: `${parent.name} - Red`,
    parent_id: parent.id,
    is_variant: true,
    variant_of_name: parent.name,
    variant_label: "Red",
    quantity: 5,
    total_quantity: 5,
    ...overrides,
  });
}

/**
 * Drives the project-wide DatePicker: clicks the trigger (by accessible name),
 * navigates to the month containing the ISO date if needed, and selects the day.
 */
export function pickDate(ariaLabel: string, iso: string): void {
  fireEvent.click(screen.getByRole("combobox", { name: ariaLabel }));
  const [y, m, d] = iso.split("-").map(Number);
  const label = `${MONTHS[m - 1]} ${d}, ${y}`;
  for (let i = 0; i < 60; i += 1) {
    const target = screen.queryByRole("button", { name: label });
    if (target) {
      fireEvent.click(target);
      return;
    }
    const dialog = screen.getByRole("dialog", { name: `${ariaLabel} picker` });
    const heading = within(dialog).getByText(/^[A-Za-z]+ \d{4}$/).textContent ?? "";
    const [monthName, yearText] = heading.split(" ");
    const current = (Number(yearText) - 1) * 12 + MONTHS.indexOf(monthName);
    const desired = (y - 1) * 12 + (m - 1);
    if (desired > current) {
      fireEvent.click(within(dialog).getByRole("button", { name: "Next month" }));
    } else {
      fireEvent.click(within(dialog).getByRole("button", { name: "Previous month" }));
    }
  }
  throw new Error(`pickDate: could not reach ${iso}`);
}
