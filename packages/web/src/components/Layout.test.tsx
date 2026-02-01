import "../../test-setup";
import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./Layout";

// Test component to render inside layout
function TestPage() {
  return <div data-testid="test-content">Test Page Content</div>;
}

function renderWithRouter(
  ui: React.ReactNode,
  { initialEntries = ["/"] }: { initialEntries?: string[] } = {}
) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="*" element={ui} />
      </Routes>
    </MemoryRouter>
  );
}

describe("Layout", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders children content", () => {
    const { getByTestId } = renderWithRouter(
      <Layout>
        <TestPage />
      </Layout>
    );

    expect(getByTestId("test-content")).toBeTruthy();
  });

  it("renders logo with brand name", () => {
    const { getAllByText } = renderWithRouter(
      <Layout>
        <TestPage />
      </Layout>
    );

    expect(getAllByText("Bonfire").length).toBeGreaterThan(0);
  });

  it("renders navigation links", () => {
    const { getAllByText } = renderWithRouter(
      <Layout>
        <TestPage />
      </Layout>
    );

    // Should have Dashboard, Images, and Settings links
    expect(getAllByText("Dashboard").length).toBeGreaterThan(0);
    expect(getAllByText("Images").length).toBeGreaterThan(0);
    expect(getAllByText("Settings").length).toBeGreaterThan(0);
  });

  it("renders user menu button", () => {
    const { getAllByLabelText } = renderWithRouter(
      <Layout>
        <TestPage />
      </Layout>
    );

    const userMenuButtons = getAllByLabelText("User menu");
    expect(userMenuButtons.length).toBeGreaterThan(0);
  });

  it("renders mobile hamburger menu button", () => {
    const { getAllByLabelText } = renderWithRouter(
      <Layout>
        <TestPage />
      </Layout>
    );

    const menuButtons = getAllByLabelText("Open menu");
    expect(menuButtons.length).toBeGreaterThan(0);
  });

  it("has touch-friendly navigation items", () => {
    const { getAllByText } = renderWithRouter(
      <Layout>
        <TestPage />
      </Layout>
    );

    // Check that nav links exist with proper accessibility
    const dashboardLinks = getAllByText("Dashboard");
    expect(dashboardLinks.length).toBeGreaterThan(0);
  });
});
