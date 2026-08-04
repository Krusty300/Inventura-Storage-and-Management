import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import api from "../api/client";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn() },
}));

import EntityBulkEditModal, { type BulkFieldConfig } from "../components/EntityBulkEditModal";

const patchMock = api.patch as ReturnType<typeof vi.fn>;

const fields: BulkFieldConfig[] = [
  { name: "notes", label: "Notes", type: "text" },
  {
    name: "is_active",
    label: "Status",
    type: "select",
    options: [
      { value: "true", label: "Active" },
      { value: "false", label: "Inactive" },
    ],
    valueType: "boolean",
  },
];

describe("EntityBulkEditModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("shows the selected count and disables submit until a field changes", () => {
    renderWithProviders(
      <EntityBulkEditModal ids={[1, 2]} entityLabel="Supplier" endpoint="/suppliers/bulk-edit" fields={fields} onClose={() => {}} onSaved={() => {}} />
    );
    expect(screen.getByText("Edit 2 Supplier(s)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update 2 Supplier(s)" })).toBeDisabled();
  });

  it("sends only changed fields with the right value types", async () => {
    patchMock.mockResolvedValue({ data: {} });
    renderWithProviders(
      <EntityBulkEditModal ids={[1, 2]} entityLabel="Supplier" endpoint="/suppliers/bulk-edit" fields={fields} onClose={() => {}} onSaved={() => {}} />
    );
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "hello" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "false" } });
    fireEvent.click(screen.getByRole("button", { name: "Update 2 Supplier(s)" }));
    await vi.waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/suppliers/bulk-edit", {
        ids: [1, 2],
        notes: "hello",
        is_active: false,
      })
    );
  });

  it("maps the clear value to an explicit null", async () => {
    patchMock.mockResolvedValue({ data: {} });
    const parentFields: BulkFieldConfig[] = [
      { name: "parent_id", label: "Parent", type: "select", options: [{ value: "__none__", label: "No parent (top-level)" }], clearValue: "__none__", valueType: "number" },
    ];
    renderWithProviders(
      <EntityBulkEditModal ids={[5]} entityLabel="Category" endpoint="/categories/bulk-edit" fields={parentFields} onClose={() => {}} onSaved={() => {}} />
    );
    fireEvent.change(screen.getByLabelText("Parent"), { target: { value: "__none__" } });
    fireEvent.click(screen.getByRole("button", { name: "Update 1 Category(s)" }));
    await vi.waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/categories/bulk-edit", { ids: [5], parent_id: null })
    );
  });

  it("shows an error message from the API and calls onSaved on success", async () => {
    patchMock.mockRejectedValueOnce({ response: { data: { detail: "No fields to update" } } });
    const onSaved = vi.fn();
    renderWithProviders(
      <EntityBulkEditModal ids={[1]} entityLabel="Order" endpoint="/orders/bulk-edit" fields={fields} onClose={() => {}} onSaved={onSaved} />
    );
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Update 1 Order(s)" }));
    expect(await screen.findByText("No fields to update")).toBeInTheDocument();

    patchMock.mockResolvedValue({ data: {} });
    fireEvent.click(screen.getByRole("button", { name: "Update 1 Order(s)" }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});
