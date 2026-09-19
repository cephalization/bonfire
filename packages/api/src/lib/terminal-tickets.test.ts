import { describe, it, expect } from "vitest";
import { createTerminalTicketStore } from "./terminal-tickets";

describe("terminal ticket store", () => {
  it("issues a ticket that redeems for its VM", () => {
    const store = createTerminalTicketStore();
    const { ticket } = store.issue("vm-1");

    expect(store.redeem(ticket, "vm-1")).toBe(true);
  });

  it("is single use", () => {
    const store = createTerminalTicketStore();
    const { ticket } = store.issue("vm-1");

    expect(store.redeem(ticket, "vm-1")).toBe(true);
    expect(store.redeem(ticket, "vm-1")).toBe(false);
  });

  it("does not redeem for a different VM", () => {
    const store = createTerminalTicketStore();
    const { ticket } = store.issue("vm-1");

    expect(store.redeem(ticket, "vm-2")).toBe(false);
  });

  it("spends a ticket even when the VM does not match, so it cannot be retried", () => {
    const store = createTerminalTicketStore();
    const { ticket } = store.issue("vm-1");

    expect(store.redeem(ticket, "vm-2")).toBe(false);
    expect(store.redeem(ticket, "vm-1")).toBe(false);
  });

  it("rejects an unknown ticket", () => {
    const store = createTerminalTicketStore();

    expect(store.redeem("not-a-real-ticket", "vm-1")).toBe(false);
  });

  it("rejects an expired ticket", async () => {
    const store = createTerminalTicketStore(1);
    const { ticket } = store.issue("vm-1");

    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(store.redeem(ticket, "vm-1")).toBe(false);
  });

  it("reports an expiry in the future", () => {
    const store = createTerminalTicketStore(30_000);
    const before = Date.now();
    const { expiresAt } = store.issue("vm-1");

    expect(expiresAt).toBeGreaterThan(before);
  });

  it("issues distinct tickets", () => {
    const store = createTerminalTicketStore();
    const a = store.issue("vm-1").ticket;
    const b = store.issue("vm-1").ticket;

    expect(a).not.toBe(b);
  });

  it("prunes expired tickets so the store does not grow unbounded", async () => {
    const store = createTerminalTicketStore(1);
    store.issue("vm-1");
    store.issue("vm-2");
    expect(store.size).toBe(2);

    await new Promise((resolve) => setTimeout(resolve, 5));
    store.prune();

    expect(store.size).toBe(0);
  });
});
