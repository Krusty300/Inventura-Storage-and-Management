import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./testUtils";
import SlideOver from "../components/SlideOver";

describe("SlideOver", () => {
  it("renders title and children when open", () => {
    renderWithProviders(
      <SlideOver open title="Test Panel" onClose={() => {}}>
        <p>Panel content</p>
      </SlideOver>
    );
    expect(screen.getByRole("heading", { name: "Test Panel" })).toBeInTheDocument();
    expect(screen.getByText("Panel content")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    renderWithProviders(
      <SlideOver open={false} title="Test" onClose={() => {}}>
        <p>Hidden</p>
      </SlideOver>
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes when the X button is clicked", () => {
    const onClose = vi.fn();
    renderWithProviders(
      <SlideOver open title="Test Panel" onClose={onClose}>
        <p>content</p>
      </SlideOver>
    );
    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the backdrop is clicked", () => {
    const onClose = vi.fn();
    renderWithProviders(
      <SlideOver open title="Test Panel" onClose={onClose}>
        <p>content</p>
      </SlideOver>
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog.querySelector("div[class*='bg-black/40']") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the Escape key is pressed", () => {
    const onClose = vi.fn();
    renderWithProviders(
      <SlideOver open title="Test Panel" onClose={onClose}>
        <p>content</p>
      </SlideOver>
    );
    fireEvent.keyDown(screen.getByText("content"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
