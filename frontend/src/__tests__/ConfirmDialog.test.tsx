import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ConfirmDialog from "../components/ConfirmDialog";

describe("ConfirmDialog", () => {
  it("renders the message and confirm label", () => {
    render(
      <ConfirmDialog open title="Delete Supplier" message="Delete Acme?" onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(screen.getByText("Delete Acme?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("calls onConfirm when the confirm button is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog open title="Delete Supplier" message="Delete Acme?" confirmLabel="Yes, delete" onConfirm={onConfirm} onCancel={() => {}} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("calls onCancel when the cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog open title="Delete Supplier" message="Delete Acme?" onConfirm={() => {}} onCancel={onCancel} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
