import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CalendarDays, Columns3, LayoutGrid, List } from "lucide-react";
import ExpandableTabs, { type ExpandableTabsTab } from "../components/ExpandableTabs";

const TABS = [
  { id: "list", label: "List", icon: List },
  { id: "card", label: "Card", icon: LayoutGrid },
  { id: "kanban", label: "Kanban", icon: Columns3 },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
] satisfies readonly ExpandableTabsTab[];

function ContentFor(value: string) {
  switch (value) {
    case "card": return <p>Card content</p>;
    case "kanban": return <p>Kanban content</p>;
    case "calendar": return <p>Calendar content</p>;
    default: return <p>List content</p>;
  }
}

function Harness({ initial = "list" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <ExpandableTabs value={value} onChange={setValue} tabs={TABS} ariaLabel="View mode">
      {ContentFor(value)}
    </ExpandableTabs>
  );
}

describe("ExpandableTabs", () => {
  it("renders an icon pill bar and the active panel above it", () => {
    render(<Harness />);
    const tablist = screen.getByRole("tablist", { name: "View mode" });
    expect(within(tablist).getAllByRole("tab")).toHaveLength(4);
    expect(within(tablist).getByRole("tab", { name: "Calendar" })).toBeTruthy();
    expect(screen.getByRole("tabpanel")).toBeInTheDocument();
    expect(screen.getByText("List content")).toBeInTheDocument();
  });

  it("marks only the active tab as selected and morphs its label open", () => {
    render(<Harness initial="card" />);
    expect(screen.getByRole("tab", { name: "Card" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "List" })).toHaveAttribute("aria-selected", "false");
    // The active pill's label grid expands to reveal text; the inactive one collapses.
    const activeLabelWrap = within(screen.getByRole("tab", { name: "Card" })).getByText("Card").parentElement;
    expect(activeLabelWrap?.className).toContain("[grid-template-columns:1fr]");
    const inactiveLabelWrap = within(screen.getByRole("tab", { name: "List" })).getByText("List").parentElement;
    expect(inactiveLabelWrap?.className).toContain("[grid-template-columns:0fr]");
    expect(screen.getByText("Card content")).toBeInTheDocument();
  });

  it("slides the panel in from the right when advancing and from the left when going back", () => {
    render(<Harness />);
    expect(screen.getByRole("tabpanel")).toHaveAttribute("data-direction", "right");

    fireEvent.click(screen.getByRole("tab", { name: "Card" }));
    expect(screen.getByText("Card content")).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("data-direction", "right");

    fireEvent.click(screen.getByRole("tab", { name: "Calendar" }));
    expect(screen.getByText("Calendar content")).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("data-direction", "right");

    fireEvent.click(screen.getByRole("tab", { name: "List" }));
    expect(screen.getByText("List content")).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("data-direction", "left");
  });

  it("navigates with the arrow keys and wraps around", () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "List" }), { key: "ArrowRight" });
    expect(screen.getByText("Card content")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("tab", { name: "Card" }), { key: "ArrowRight" });
    expect(screen.getByText("Kanban content")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("tab", { name: "Kanban" }), { key: "ArrowRight" });
    expect(screen.getByText("Calendar content")).toBeInTheDocument();

    // Wrap around from the last tab to the first.
    fireEvent.keyDown(screen.getByRole("tab", { name: "Calendar" }), { key: "ArrowRight" });
    expect(screen.getByText("List content")).toBeInTheDocument();

    // Wrap around from the first tab to the last.
    fireEvent.keyDown(screen.getByRole("tab", { name: "List" }), { key: "ArrowLeft" });
    expect(screen.getByText("Calendar content")).toBeInTheDocument();
  });

  it("associates the tabpanel with the active tab via WAI-ARIA ids", () => {
    render(<Harness initial="kanban" />);
    const panel = screen.getByRole("tabpanel");
    const selected = screen.getByRole("tab", { name: "Kanban" });
    expect(selected).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", selected.id);
  });

  it("supports the renderPanel API for active-tab content", () => {
    render(
      <ExpandableTabs
        value="card"
        onChange={() => {}}
        tabs={TABS}
        ariaLabel="View mode"
        renderPanel={(tab) => <p>Active: {tab.label}</p>}
      />,
    );
    expect(screen.getByText("Active: Card")).toBeInTheDocument();
  });
});