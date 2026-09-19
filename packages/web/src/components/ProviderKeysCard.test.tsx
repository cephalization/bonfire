import "../../test-setup";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ProviderKeysCard } from "./ProviderKeysCard";
import type { Provider } from "@/lib/api";

const api = vi.hoisted(() => ({
  listProviders: vi.fn(),
  setProviderKey: vi.fn(),
  deleteProviderKey: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

const providers: Provider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    keysUrl: "https://console.anthropic.com/settings/keys",
    configured: true,
    keyHint: "…1234",
    label: "team",
    updatedAt: new Date().toISOString(),
  },
  {
    id: "openai",
    name: "OpenAI",
    keysUrl: "https://platform.openai.com/api-keys",
    configured: false,
    keyHint: null,
    label: null,
    updatedAt: null,
  },
];

describe("ProviderKeysCard", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    api.listProviders.mockResolvedValue(providers);
  });

  it("shows which providers are configured, read-only for members", async () => {
    const { findByText, getByText, queryByText } = render(
      <ProviderKeysCard organizationId="org-1" canManage={false} onError={() => {}} />
    );
    expect(await findByText("Anthropic")).toBeTruthy();
    expect(getByText("…1234")).toBeTruthy();
    expect(getByText("Not configured")).toBeTruthy();
    expect(queryByText("Set key")).toBeNull();
    expect(queryByText("Replace key")).toBeNull();
    expect(api.listProviders).toHaveBeenCalledWith("org-1");
  });

  it("lets admins set and remove keys", async () => {
    api.setProviderKey.mockResolvedValue({ ...providers[1], configured: true, keyHint: "…abcd" });
    api.deleteProviderKey.mockResolvedValue({ ...providers[0], configured: false });
    const onError = vi.fn();
    const { findByText, getByText, getByLabelText, getByRole } = render(
      <ProviderKeysCard organizationId="org-1" canManage onError={onError} />
    );
    await findByText("Anthropic");

    fireEvent.click(getByText("Set key"));
    fireEvent.change(getByLabelText("OpenAI API key"), {
      target: { value: "sk-openai-secret-key" },
    });
    fireEvent.change(getByLabelText("Label"), { target: { value: "prod" } });
    fireEvent.submit(getByText("Save").closest("form")!);
    await waitFor(() =>
      expect(api.setProviderKey).toHaveBeenCalledWith("org-1", "openai", {
        apiKey: "sk-openai-secret-key",
        label: "prod",
      })
    );
    expect(api.listProviders).toHaveBeenCalledTimes(2);

    fireEvent.click(getByRole("button", { name: "Remove Anthropic key" }));
    await waitFor(() => expect(api.deleteProviderKey).toHaveBeenCalledWith("org-1", "anthropic"));
    expect(onError).toHaveBeenCalledWith(null);
  });
});
