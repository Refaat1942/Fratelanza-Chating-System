import { pgTable, serial, text, integer, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/**
 * Chat bots (menu / survey / action flows). A bot greets new conversations,
 * asks its steps, routes to a team / topic, saves answers to the customer and
 * hands over to a person. Steps are stored as JSON (edited as one flow).
 * Bots are created inactive and never run while sending is switched off.
 */
export const botsTable = pgTable("bots", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  kind: text("kind", { enum: ["menu", "survey", "action"] }).notNull().default("menu"),
  channel: text("channel").notNull().default("all"),
  isActive: boolean("is_active").notNull().default(false),
  trigger: text("trigger", { enum: ["new_conversation", "keyword"] }).notNull().default("new_conversation"),
  keywords: text("keywords").array().notNull().default([]),
  welcomeMessage: text("welcome_message"),
  fallbackMessage: text("fallback_message"),
  handoverMessage: text("handover_message"),
  completionMessage: text("completion_message"),
  endAction: text("end_action", { enum: ["handover", "close"] }).notNull().default("handover"),
  maxFallbacks: integer("max_fallbacks").notNull().default(2),
  offHours: jsonb("off_hours").$type<{ enabled: boolean; start: string; end: string; days: number[]; message: string } | null>(),
  steps: jsonb("steps").$type<unknown[]>().notNull().default([]),
  priority: integer("priority").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const botSessionsTable = pgTable(
  "bot_sessions",
  {
    id: serial("id").primaryKey(),
    botId: integer("bot_id").notNull(),
    conversationId: integer("conversation_id").notNull(),
    status: text("status", { enum: ["active", "completed", "handed_over", "abandoned"] }).notNull().default("active"),
    stepKey: text("step_key"),
    answers: jsonb("answers").$type<Record<string, string>>().notNull().default({}),
    fallbacks: integer("fallbacks").notNull().default(0),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    lastActivityAt: timestamp("last_activity_at").notNull().defaultNow(),
    endedAt: timestamp("ended_at"),
  },
  (t) => [index("bot_sessions_conv_idx").on(t.conversationId, t.status), index("bot_sessions_bot_idx").on(t.botId)],
);

export type Bot = typeof botsTable.$inferSelect;
export type BotSession = typeof botSessionsTable.$inferSelect;
