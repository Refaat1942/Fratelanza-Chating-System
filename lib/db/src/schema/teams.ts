import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * Teams / groups of agents (e.g. "Pharmacy", "Delivery", "Complaints").
 * Members: `users.team_id`. Conversations can be routed to a team
 * (`conversations.team_id`): auto-assignment then picks only that team.
 */
export const teamsTable = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  color: text("color"),
  /** Team leader / supervisor responsible for the team. */
  leaderId: integer("leader_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Team = typeof teamsTable.$inferSelect;
