import { pgTable, serial, text, integer, boolean, timestamp, numeric, index } from "drizzle-orm/pg-core";

export const driverGroupsTable = pgTable("driver_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const driversTable = pgTable("drivers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  groupId: integer("group_id"),
  vehicle: text("vehicle"),
  status: text("status", { enum: ["available", "on_delivery", "off"] }).notNull().default("available"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const DELIVERY_STATUSES = ["new", "assigned", "picked_up", "on_the_way", "delivered", "failed", "cancelled"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const deliveryOrdersTable = pgTable(
  "delivery_orders",
  {
    id: serial("id").primaryKey(),
    orderNumber: text("order_number").notNull().unique(),
    customerId: integer("customer_id").notNull(),
    conversationId: integer("conversation_id"),
    driverId: integer("driver_id"),
    status: text("status", { enum: DELIVERY_STATUSES }).notNull().default("new"),
    address: text("address"),
    notes: text("notes"),
    amount: numeric("amount", { precision: 12, scale: 2 }),
    scheduledFor: timestamp("scheduled_for"),
    createdBy: integer("created_by"),
    deliveredAt: timestamp("delivered_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("delivery_customer_idx").on(t.customerId), index("delivery_driver_idx").on(t.driverId), index("delivery_status_idx").on(t.status)],
);

/** Status history of each order (who / when / note). */
export const deliveryEventsTable = pgTable(
  "delivery_events",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id").notNull(),
    status: text("status").notNull(),
    driverId: integer("driver_id"),
    note: text("note"),
    actorId: integer("actor_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("delivery_events_order_idx").on(t.orderId)],
);

export type Driver = typeof driversTable.$inferSelect;
export type DeliveryOrder = typeof deliveryOrdersTable.$inferSelect;
