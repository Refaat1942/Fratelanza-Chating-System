import { pgTable, serial, text, timestamp, boolean, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const customersTable = pgTable("customers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  branch: text("branch"),
  address: text("address"),
  tags: text("tags").array().notNull().default([]),
  notes: text("notes"),
  prescriptionNotes: text("prescription_notes"),
  isBlocked: boolean("is_blocked").notNull().default(false),
  blockedReason: text("blocked_reason"),
  blockedAt: timestamp("blocked_at"),
  // Social identities: Messenger PSID / Instagram-scoped id (page-specific).
  messengerPsid: text("messenger_psid"),
  instagramId: text("instagram_id"),
  email: text("email"),
  // Admin-defined extra fields (Settings → Customer fields), key → value.
  customFields: jsonb("custom_fields").$type<Record<string, string>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("customers_messenger_psid_uniq").on(t.messengerPsid),
  uniqueIndex("customers_instagram_id_uniq").on(t.instagramId),
]);

export const insertCustomerSchema = createInsertSchema(customersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customersTable.$inferSelect;
