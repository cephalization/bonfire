/**
 * Terminal Connection Tickets
 *
 * Browsers cannot set headers on a WebSocket handshake, so the terminal
 * WebSocket cannot be authenticated with `X-API-Key` the way the REST API is.
 *
 * Instead the client makes a normal authenticated POST to mint a ticket, then
 * puts that ticket in the WebSocket URL. Tickets are single-use and expire in
 * seconds, so a leaked URL (server logs, browser history, a `Referer` header)
 * does not hand over the long-lived API key.
 *
 * The store is in-memory and therefore per-process. That is fine while Bonfire
 * runs as a single API server; a multi-instance deployment needs shared
 * storage. See CLAUDE.md — this is also the seam where per-user auth will
 * attach in the next milestone, since a ticket is already "one principal, one
 * VM, right now".
 */

import { randomBytes } from "crypto";

/** How long a freshly minted ticket stays valid. */
export const TICKET_TTL_MS = 30_000;

interface Ticket {
  vmId: string;
  expiresAt: number;
}

export interface TerminalTicketStore {
  issue(vmId: string): { ticket: string; expiresAt: number };
  /** Redeems the ticket, returning true only if it is valid for this VM. */
  redeem(ticket: string, vmId: string): boolean;
  /** Drops expired tickets. Called on every issue; exposed for tests. */
  prune(now?: number): void;
  readonly size: number;
}

export function createTerminalTicketStore(ttlMs: number = TICKET_TTL_MS): TerminalTicketStore {
  const tickets = new Map<string, Ticket>();

  const prune = (now: number = Date.now()): void => {
    for (const [value, ticket] of tickets) {
      if (ticket.expiresAt <= now) {
        tickets.delete(value);
      }
    }
  };

  return {
    issue(vmId: string) {
      // Keep the map from growing without bound when tickets go unredeemed.
      prune();

      const ticket = randomBytes(32).toString("base64url");
      const expiresAt = Date.now() + ttlMs;
      tickets.set(ticket, { vmId, expiresAt });
      return { ticket, expiresAt };
    },

    redeem(ticket: string, vmId: string): boolean {
      const found = tickets.get(ticket);
      if (!found) return false;

      // Single use: a ticket is spent whether or not it turns out to be valid,
      // so a guessed or replayed value cannot be retried.
      tickets.delete(ticket);

      if (found.expiresAt <= Date.now()) return false;
      return found.vmId === vmId;
    },

    prune,

    get size() {
      return tickets.size;
    },
  };
}
