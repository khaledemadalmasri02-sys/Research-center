import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button, Card, Input, Badge, Tabs, Table, Skeleton, Select, Textarea } from "./ui";

describe("UI Components", () => {
  describe("Button", () => {
    it("renders button with children", () => {
      render(<Button>Click me</Button>);
      expect(screen.getByRole("button", { name: /click me/i })).not.toBeNull();
    });

    it("applies danger variant classes", () => {
      render(<Button variant="danger">Delete</Button>);
      const button = screen.getByRole("button", { name: /delete/i });
      expect(button.className).toContain("bg-red-600");
    });
  });

  describe("Card", () => {
    it("renders card with header, content, footer", () => {
      render(
        <Card>
          <h2>Title</h2>
          <p>Content</p>
        </Card>
      );
      expect(screen.getByText("Title")).not.toBeNull();
      expect(screen.getByText("Content")).not.toBeNull();
    });
  });

  describe("Input", () => {
    it("renders input with placeholder", () => {
      render(<Input placeholder="Enter text" />);
      expect(screen.getByPlaceholderText("Enter text")).not.toBeNull();
    });
  });

  describe("Badge", () => {
    it("renders badge with text", () => {
      render(<Badge>New</Badge>);
      expect(screen.getByText("New")).not.toBeNull();
    });

    it("applies default blue styling", () => {
      render(<Badge>Error</Badge>);
      const badge = screen.getByText("Error");
      expect(badge.className).toContain("bg-blue-100");
    });
  });

  describe("Textarea", () => {
    it("renders textarea with placeholder", () => {
      render(<Textarea placeholder="Notes" />);
      expect(screen.getByPlaceholderText("Notes")).not.toBeNull();
    });
  });

  describe("Select", () => {
    it("renders options", () => {
      render(
        <Select>
          <option value="a">A</option>
          <option value="b">B</option>
        </Select>,
      );
      expect(screen.getByRole("option", { name: "A" })).not.toBeNull();
      expect(screen.getByRole("option", { name: "B" })).not.toBeNull();
    });
  });

  describe("Tabs", () => {
    it("renders each tab and marks the active one", () => {
      const onChange = vi.fn();
      render(<Tabs tabs={["One", "Two", "Three"]} active="Two" onChange={onChange} />);
      const active = screen.getByRole("button", { name: "Two" });
      expect(active.className).toContain("border-blue-600");
      const inactive = screen.getByRole("button", { name: "One" });
      expect(inactive.className).not.toContain("border-blue-600");
    });

    it("calls onChange with the clicked tab", async () => {
      const onChange = vi.fn();
      render(<Tabs tabs={["A", "B"]} active="A" onChange={onChange} />);
      await userEvent.click(screen.getByRole("button", { name: "B" }));
      expect(onChange).toHaveBeenCalledWith("B");
    });
  });

  describe("Table", () => {
    it("renders headers and rows", () => {
      render(
        <Table
          headers={["Name", "Role"]}
          rows={[
            [<span key="1">Alice</span>, <span key="2">admin</span>],
            [<span key="3">Bob</span>, <span key="4">editor</span>],
          ]}
        />,
      );
      expect(screen.getByText("Name")).not.toBeNull();
      expect(screen.getByText("Role")).not.toBeNull();
      expect(screen.getByText("Alice")).not.toBeNull();
      expect(screen.getByText("editor")).not.toBeNull();
    });
  });

  describe("Skeleton", () => {
    it("renders a div with the animate-pulse class", () => {
      const { container } = render(<Skeleton className="h-4 w-2" />);
      const el = container.querySelector(".animate-pulse");
      expect(el).not.toBeNull();
      expect(el!.className).toContain("h-4");
    });
  });
});
