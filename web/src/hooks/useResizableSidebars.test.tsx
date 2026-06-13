import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useResizableSidebars } from "./useResizableSidebars";

const TestResizableSidebars = ({ storageKey }: { storageKey?: string }) => {
  const { containerRef, leftWidth, rightWidth, leftResizeHandleProps, rightResizeHandleProps } = useResizableSidebars({ storageKey });

  return (
    <div>
      <div ref={containerRef} data-testid="container" style={{ width: 1000 }}>
        <div data-testid="left-width">{leftWidth}</div>
        <div data-testid="right-width">{rightWidth}</div>
        <div data-testid="left-handle" {...leftResizeHandleProps} />
        <div data-testid="right-handle" {...rightResizeHandleProps} />
      </div>
    </div>
  );
};

const mockContainerRect = (element: HTMLElement, width = 1000) => {
  element.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: 600,
    width,
    height: 600,
    toJSON: () => undefined,
  });
};

const pointerDown = (element: HTMLElement, clientX: number) => {
  element.setPointerCapture = () => undefined;
  element.releasePointerCapture = () => undefined;
  fireEvent.pointerDown(element, { button: 0, pointerId: 1, clientX });
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

describe("useResizableSidebars", () => {
  it("resizes and persists the left sidebar width", () => {
    render(<TestResizableSidebars storageKey="test-detail-sidebar" />);
    mockContainerRect(screen.getByTestId("container"));

    pointerDown(screen.getByTestId("left-handle"), 200);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(screen.getByTestId("left-width").textContent).toBe("30");
    expect(localStorage.getItem("test-detail-sidebar:left")).toBe("30");
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("resizes and persists the right sidebar width", () => {
    render(<TestResizableSidebars storageKey="test-detail-sidebar" />);
    mockContainerRect(screen.getByTestId("container"));

    pointerDown(screen.getByTestId("right-handle"), 800);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 750 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(screen.getByTestId("right-width").textContent).toBe("25");
    expect(localStorage.getItem("test-detail-sidebar:right")).toBe("25");
  });

  it("clamps sidebars to safe min and max widths", () => {
    render(<TestResizableSidebars storageKey="test-detail-sidebar" />);
    mockContainerRect(screen.getByTestId("container"));

    pointerDown(screen.getByTestId("left-handle"), 200);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 900 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(screen.getByTestId("left-width").textContent).toBe("35");

    pointerDown(screen.getByTestId("right-handle"), 800);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 950 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(screen.getByTestId("right-width").textContent).toBe("10");
  });

  it("loads stored sidebar widths on mount", () => {
    localStorage.setItem("test-detail-sidebar:left", "28");
    localStorage.setItem("test-detail-sidebar:right", "32");

    render(<TestResizableSidebars storageKey="test-detail-sidebar" />);

    expect(screen.getByTestId("left-width").textContent).toBe("28");
    expect(screen.getByTestId("right-width").textContent).toBe("32");
  });
});
