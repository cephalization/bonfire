/**
 * In-process pub/sub for conversation updates.
 *
 * Routes publish here when a message is created or an agent streams output,
 * and the SSE endpoint (`GET /api/conversations/:id/events`) subscribes. Like
 * the terminal ticket store this is per process, which is fine for a single
 * API server.
 */

import type { Conversation, ConversationMessage } from "../db/schema";

export type ConversationEvent =
  | { type: "message.created"; message: ConversationMessage }
  | { type: "message.updated"; message: ConversationMessage }
  | { type: "conversation.updated"; conversation: Conversation }
  | { type: "participant.joined"; participant: { userId: string; name: string } };

export type ConversationEventHandler = (event: ConversationEvent) => void;

export interface ConversationEventBus {
  publish(conversationId: string, event: ConversationEvent): void;
  subscribe(conversationId: string, handler: ConversationEventHandler): () => void;
  /** Number of live subscribers, for tests and diagnostics. */
  subscriberCount(conversationId: string): number;
}

export function createConversationEventBus(): ConversationEventBus {
  const handlers = new Map<string, Set<ConversationEventHandler>>();

  return {
    publish(conversationId, event) {
      const set = handlers.get(conversationId);
      if (!set) return;
      for (const handler of set) {
        try {
          handler(event);
        } catch (error) {
          console.warn("[conversations] event handler failed:", error);
        }
      }
    },

    subscribe(conversationId, handler) {
      let set = handlers.get(conversationId);
      if (!set) {
        set = new Set();
        handlers.set(conversationId, set);
      }
      set.add(handler);
      return () => {
        set!.delete(handler);
        if (set!.size === 0) handlers.delete(conversationId);
      };
    },

    subscriberCount(conversationId) {
      return handlers.get(conversationId)?.size ?? 0;
    },
  };
}
