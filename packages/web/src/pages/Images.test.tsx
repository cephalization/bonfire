import "../../test-setup";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Images } from "./Images";
import * as api from "@/lib/api";
import type { Image } from "@/lib/api";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    listImages: vi.fn(async () => []),
    deleteImage: vi.fn(async () => ({ success: true })),
    pullImage: vi.fn(async () => ({
      id: "img-123",
      reference: "ghcr.io/test/image:latest",
      kernelPath: "/var/lib/bonfire/images/img-123/kernel",
      rootfsPath: "/var/lib/bonfire/images/img-123/rootfs.ext4",
      sizeBytes: 1024 * 1024 * 100,
      pulledAt: "2024-01-01T00:00:00Z",
    })),
  };
});

function createMockImage(overrides: Partial<Image> = {}): Image {
  return {
    id: "img-123",
    reference: "ghcr.io/openfaasltd/slicer-systemd:latest",
    kernelPath: "/var/lib/bonfire/images/img-123/kernel",
    rootfsPath: "/var/lib/bonfire/images/img-123/rootfs.ext4",
    sizeBytes: 1024 * 1024 * 100, // 100 MB
    pulledAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderWithRouter(component: React.ReactNode) {
  return render(<MemoryRouter>{component}</MemoryRouter>);
}

// Helper to find text content that might be split across elements
function textMatcher(text: string) {
  return (_: string, node: Element | null) => {
    if (!node) return false;
    const hasText = (n: Element) => n.textContent === text;
    const nodeHasText = hasText(node);
    const childrenDontHaveText = Array.from(node.children).every(
      (child) => !hasText(child)
    );
    return nodeHasText && childrenDontHaveText;
  };
}

describe("Images", () => {
  const mockListImages = vi.mocked(api.listImages);
  const mockDeleteImage = vi.mocked(api.deleteImage);

  beforeEach(() => {
    cleanup();
    mockListImages.mockClear();
    mockDeleteImage.mockClear();
  });

  describe("Rendering", () => {
    it("renders page title and description", async () => {
      mockListImages.mockImplementation(() => Promise.resolve([]));
      
      const { getByText } = renderWithRouter(<Images />);
      
      await waitFor(() => {
        expect(getByText("Images")).toBeTruthy();
        expect(getByText("Manage your cached container images")).toBeTruthy();
      });
    });

    it("shows loading state initially", () => {
      mockListImages.mockImplementation(() => new Promise(() => {})); // Never resolves
      
      const { getByTestId } = renderWithRouter(<Images />);
      
      expect(getByTestId("images-loading")).toBeTruthy();
    });

    it("renders empty state when no images", async () => {
      mockListImages.mockImplementation(() => Promise.resolve([]));
      
      const { getByTestId, getByText } = renderWithRouter(<Images />);
      
      await waitFor(() => {
        expect(getByTestId("images-empty")).toBeTruthy();
        expect(getByText("No images yet")).toBeTruthy();
        expect(getByText("Pull your first container image to get started with Bonfire.")).toBeTruthy();
      });
    });

    it("renders list of images", async () => {
      const images = [
        createMockImage({ id: "img-1", reference: "image1:latest" }),
        createMockImage({ id: "img-2", reference: "image2:latest" }),
      ];
      mockListImages.mockImplementation(() => Promise.resolve(images));
      
      const { getByTestId, getByText } = renderWithRouter(<Images />);
      
      await waitFor(() => {
        expect(getByTestId("images-list")).toBeTruthy();
        expect(getByText("image1:latest")).toBeTruthy();
        expect(getByText("image2:latest")).toBeTruthy();
      });
    });

    it("renders image details correctly", async () => {
      const image = createMockImage({
        id: "img-1",
        reference: "test-image:latest",
        sizeBytes: 1024 * 1024 * 50, // 50 MB
        pulledAt: "2024-06-15T10:30:00Z",
      });
      mockListImages.mockImplementation(() => Promise.resolve([image]));
      
      const { getByText, getByTestId } = renderWithRouter(<Images />);
      
      await waitFor(() => {
        expect(getByTestId("image-card-img-1")).toBeTruthy();
        expect(getByText("test-image:latest")).toBeTruthy();
      });
    });
  });

  describe("Error handling", () => {
    it("shows error when fetch fails", async () => {
      mockListImages.mockImplementation(() => 
        Promise.reject(new api.BonfireAPIError("Network error", 500))
      );
      
      const { getByTestId, getByText } = renderWithRouter(<Images />);
      
      await waitFor(() => {
        expect(getByTestId("images-error")).toBeTruthy();
        expect(getByText("Network error")).toBeTruthy();
      });
    });

    it("can dismiss error", async () => {
      mockListImages.mockImplementation(() => 
        Promise.reject(new api.BonfireAPIError("Network error", 500))
      );
      
      const { getByTestId, getByText, queryByTestId } = renderWithRouter(<Images />);
      
      await waitFor(() => {
        expect(getByTestId("images-error")).toBeTruthy();
      });
      
      fireEvent.click(getByText("Dismiss"));
      
      await waitFor(() => {
        expect(queryByTestId("images-error")).toBeNull();
      });
    });
  });

  describe("Pull Image Dialog", () => {
    it("shows pull image button in header", async () => {
      mockListImages.mockImplementation(() => Promise.resolve([]));
      
      const { getByTestId } = renderWithRouter(<Images />);
      
      await waitFor(() => {
        expect(getByTestId("pull-image-btn")).toBeTruthy();
      });
    });

    it("shows pull image button in empty state", async () => {
      mockListImages.mockImplementation(() => Promise.resolve([]));
      
      const { getByTestId } = renderWithRouter(<Images />);
      
      await waitFor(() => {
        expect(getByTestId("pull-image-btn-empty")).toBeTruthy();
      });
    });
  });

  describe("Delete functionality", () => {
    it("shows delete button for each image", async () => {
      const image = createMockImage({ id: "img-1" });
      mockListImages.mockImplementation(() => Promise.resolve([image]));
      
      const { getByTestId } = renderWithRouter(<Images />);
      
      await waitFor(() => {
        expect(getByTestId("image-delete-btn-img-1")).toBeTruthy();
      });
    });

    it("calls deleteImage when delete button is clicked", async () => {
      const image = createMockImage({ id: "img-1" });
      mockListImages.mockImplementation(() => Promise.resolve([image]));
      mockDeleteImage.mockImplementation(() => Promise.resolve({ success: true }));
      
      const { getByTestId } = renderWithRouter(<Images />);
      
      await waitFor(() => {
        expect(getByTestId("image-delete-btn-img-1")).toBeTruthy();
      });
      
      fireEvent.click(getByTestId("image-delete-btn-img-1"));
      
      await waitFor(() => {
        expect(mockDeleteImage).toHaveBeenCalledWith("img-1");
      });
    });
  });

  describe("Format helpers", () => {
    it("formats bytes correctly", async () => {
      const testCases = [
        { bytes: 512, expected: /512 B/ },
        { bytes: 1024, expected: /1 KB/ },
        { bytes: 1024 * 1024, expected: /1 MB/ },
        { bytes: 1024 * 1024 * 1024, expected: /1 GB/ },
      ];

      for (const { bytes, expected } of testCases) {
        const image = createMockImage({ id: `img-${bytes}`, sizeBytes: bytes });
        mockListImages.mockImplementation(() => Promise.resolve([image]));
        
        const { container, unmount } = renderWithRouter(<Images />);
        
        await waitFor(() => {
          expect(container.textContent).toMatch(expected);
        });
        
        unmount();
        cleanup();
      }
    });

    it("handles null size", async () => {
      const image = createMockImage({ id: "img-null", sizeBytes: null });
      mockListImages.mockImplementation(() => Promise.resolve([image]));
      
      const { container } = renderWithRouter(<Images />);
      
      await waitFor(() => {
        expect(container.textContent).toMatch(/Unknown/);
      });
    });

    it("handles zero bytes", async () => {
      const image = createMockImage({ id: "img-zero", sizeBytes: 0 });
      mockListImages.mockImplementation(() => Promise.resolve([image]));
      
      const { container } = renderWithRouter(<Images />);
      
      await waitFor(() => {
        expect(container.textContent).toMatch(/0 B/);
      });
    });
  });
});
