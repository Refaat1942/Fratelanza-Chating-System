import { pgTable, serial, text, integer, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * WhatsApp message templates, synced (read-only) from the WhatsApp Business
 * Account. Approved templates can be sent outside the 24-hour window.
 */
export const whatsappTemplatesTable = pgTable(
  "whatsapp_templates",
  {
    id: serial("id").primaryKey(),
    metaId: text("meta_id"),
    name: text("name").notNull(),
    language: text("language").notNull(),
    category: text("category"),
    status: text("status").notNull(),
    components: jsonb("components").$type<unknown[]>(),
    rejectedReason: text("rejected_reason"),
    usageCount: integer("usage_count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at"),
    syncedAt: timestamp("synced_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("wa_template_name_lang").on(t.name, t.language)],
);

export type WhatsAppTemplate = typeof whatsappTemplatesTable.$inferSelect;
