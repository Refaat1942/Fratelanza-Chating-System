import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { conversationsTable } from "./conversations";
import { usersTable } from "./users";

/**
 * Whisper Mode: private supervisor <-> agent messages about a live chat.
 *
 * Deliberately a separate table from `messages`: nothing that reads customer
 * history (inbox, WhatsApp sending, webhooks, campaigns, AI summaries, exports)
 * can pick these up by accident. `agentId` is the agent the thread is with —
 * an agent only ever sees threads where they are that agent.
 */
export const whisperMessagesTable = pgTable(
  "whisper_messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id").notNull().references(() => conversationsTable.id),
    agentId: integer("agent_id").notNull().references(() => usersTable.id),
    senderId: integer("sender_id").notNull().references(() => usersTable.id),
    body: text("body").notNull(),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("whisper_conv_idx").on(t.conversationId), index("whisper_agent_idx").on(t.agentId)],
);

export type WhisperMessage = typeof whisperMessagesTable.$inferSelect;
