import { pgTable, serial, text, integer, timestamp, customType } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/**
 * Media received from customers (WhatsApp photos / voice notes / documents,
 * Messenger & Instagram attachments). Stored in the database so it survives
 * redeploys and is included in the normal database backup. Served by an
 * unguessable `key` (capability URL) at /api/media/:key.
 */
export const mediaFilesTable = pgTable("media_files", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  mime: text("mime").notNull(),
  filename: text("filename"),
  size: integer("size").notNull(),
  data: bytea("data").notNull(),
  source: text("source"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type MediaFile = typeof mediaFilesTable.$inferSelect;
