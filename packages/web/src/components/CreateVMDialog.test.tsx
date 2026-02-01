import "../../test-setup";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CreateVMDialog } from "./CreateVMDialog";
import * as api from "@/lib/api";
import type { Image, VM } from "@/lib/api";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    listImages: vi.fn(async () => []),
    createVM: vi.fn(
      async () =>
        ({
          id: "vm-1",
          name: "test-vm",
          status: "creating",
          vcpus: 2,
          memoryMib: 1024,
          imageId: "img-1",
          pid: null,
          socketPath: null,
          tapDevice: null,
          macAddress: null,
          ipAddress: null,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        }) as VM
    ),
  };
});

function renderWithRouter(component: React.ReactNode) {
  return render(<MemoryRouter>{component}</MemoryRouter>);
}

describe("CreateVMDialog", () => {
  const mockImages: Image[] = [
    {
      id: "img-1",
      reference: "ghcr.io/openfaasltd/slicer-systemd:latest",
      kernelPath: "/var/lib/bonfire/images/img-1/kernel",
      rootfsPath: "/var/lib/bonfire/images/img-1/rootfs",
      sizeBytes: 1000000,
      pulledAt: "2024-01-01T00:00:00Z",
    },
  ];

  const mockListImages = vi.mocked(api.listImages);

  beforeEach(() => {
    cleanup();
    mockListImages.mockClear();
  });

  it("renders the trigger button", () => {
    const { getByTestId } = renderWithRouter(<CreateVMDialog />);
    expect(getByTestId("create-vm-btn")).toBeTruthy();
  });

  it("opens dialog when trigger is clicked", async () => {
    mockListImages.mockImplementation(() => Promise.resolve(mockImages));

    const { getByTestId, getByText } = renderWithRouter(<CreateVMDialog />);

    fireEvent.click(getByTestId("create-vm-btn"));

    await waitFor(() => {
      expect(getByText("Create Virtual Machine")).toBeTruthy();
    });
  });

  it("fetches images when opened", async () => {
    mockListImages.mockImplementation(() => Promise.resolve(mockImages));

    const { getByTestId } = renderWithRouter(<CreateVMDialog />);

    fireEvent.click(getByTestId("create-vm-btn"));

    await waitFor(() => {
      expect(mockListImages).toHaveBeenCalled();
    });
  });

  it("shows default values for vcpus and memory", async () => {
    mockListImages.mockImplementation(() => Promise.resolve(mockImages));

    const { getByTestId } = renderWithRouter(<CreateVMDialog />);

    fireEvent.click(getByTestId("create-vm-btn"));
    await waitFor(() => expect(mockListImages).toHaveBeenCalled());

    const vcpusInput = getByTestId("vm-vcpus-input") as HTMLInputElement;
    const memoryInput = getByTestId("vm-memory-input") as HTMLInputElement;

    expect(vcpusInput.value).toBe("1");
    expect(memoryInput.value).toBe("512");
  });

  it("closes dialog on cancel", async () => {
    mockListImages.mockImplementation(() => Promise.resolve(mockImages));

    const { getByTestId, getByText, queryByText } = renderWithRouter(<CreateVMDialog />);

    fireEvent.click(getByTestId("create-vm-btn"));
    await waitFor(() => expect(mockListImages).toHaveBeenCalled());

    fireEvent.click(getByText("Cancel"));

    await waitFor(() => {
      expect(queryByText("Create Virtual Machine")).toBeNull();
    });
  });
});
