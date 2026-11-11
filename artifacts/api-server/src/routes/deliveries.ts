/**
 * Drivers & delivery orders.
 *  - Drivers / groups: admins and supervisors manage them.
 *  - Orders: anyone who can manage customers creates and updates them
 *    (typically from the chat). Every change is kept in delivery_events.
 *  - Linked to the customer and (optionally) the conversation: each status
 *    change leaves an internal note in the chat, and can optionally tell the
 *    customer (kill switch respected).
 */
import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import type { Server as IOServer } from "socket.io";
import {
  db, driversTable, driverGroupsTable, deliveryOrdersTable, deliveryEventsTable, customersTable, conversationsTable, messagesTable,
  DELIVERY_STATUSES, type DeliveryStatus,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { requirePermission } from "../middlewares/permissions";
import { isLead } from "../lib/roles";
import { deliverToCustomer } from "../lib/deliver";
import { outboundEnabled } from "../lib/outbound";
import { logAudit } from "../lib/audit";

const router = Router();
const ACTIVE: DeliveryStatus[] = ["assigned", "picked_up", "on_the_way"];
const LABEL: Record<DeliveryStatus, string> = {
  new: "created", assigned: "assigned to a driver", picked_up: "picked up", on_the_way: "on the way",
  delivered: "delivered", failed: "could not be delivered", cancelled: "cancelled",
};
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) || null : null);

function leadOnly(req: AuthRequest, res: import("express").Response): boolean {
  if (isLead(req.user?.role)) return true;
  res.status(403).json({ error: "Only admins and supervisors can manage drivers" });
  return false;
}

// ── Groups ──────────────────────────────────────────────────────────────────

router.get("/driver-groups", requireAuth, async (_req, res) => {
  const r = await db.execute(sql`
    SELECT g.*, COUNT(d.id) FILTER (WHERE d.is_active)::int AS drivers
    FROM driver_groups g LEFT JOIN drivers d ON d.group_id = g.id GROUP BY g.id ORDER BY g.name`);
  res.json(r.rows ?? []);
});

router.post("/driver-groups", requireAuth, async (req: AuthRequest, res) => {
  if (!leadOnly(req, res)) return;
  const name = str(req.body?.name, 60);
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  try {
    const [g] = await db.insert(driverGroupsTable).values({ name, description: str(req.body?.description, 300) }).returning();
    res.status(201).json(g);
  } catch { res.status(409).json({ error: "A group with this name already exists" }); }
});

router.delete("/driver-groups/:id", requireAuth, async (req: AuthRequest, res) => {
  if (!leadOnly(req, res)) return;
  const id = Number(req.params.id);
  await db.update(driversTable).set({ groupId: null }).where(eq(driversTable.groupId, id));
  await db.delete(driverGroupsTable).where(eq(driverGroupsTable.id, id));
  res.status(204).send();
});

// ── Drivers ─────────────────────────────────────────────────────────────────

router.get("/drivers", requireAuth, async (_req, res) => {
  const r = await db.execute(sql`
    SELECT d.*, g.name AS group_name,
      COUNT(o.id) FILTER (WHERE o.status IN ('assigned','picked_up','on_the_way'))::int AS active_orders,
      COUNT(o.id) FILTER (WHERE o.status = 'delivered')::int AS delivered,
      COUNT(o.id) FILTER (WHERE o.status = 'failed')::int AS failed,
      MAX(o.updated_at) AS last_activity
    FROM drivers d
    LEFT JOIN driver_groups g ON g.id = d.group_id
    LEFT JOIN delivery_orders o ON o.driver_id = d.id
    GROUP BY d.id, g.name ORDER BY d.is_active DESC, d.name`);
  res.json(r.rows ?? []);
});

function driverPayload(b: Record<string, unknown>) {
  return {
    name: str(b.name, 80) ?? "",
    phone: str(b.phone, 30) ?? "",
    groupId: Number.isInteger(b.groupId) ? (b.groupId as number) : null,
    vehicle: str(b.vehicle, 80),
    notes: str(b.notes, 500),
    ...(typeof b.isActive === "boolean" ? { isActive: b.isActive } : {}),
    ...(b.status === "available" || b.status === "off" || b.status === "on_delivery" ? { status: b.status as "available" | "off" | "on_delivery" } : {}),
  };
}

router.post("/drivers", requireAuth, async (req: AuthRequest, res) => {
  if (!leadOnly(req, res)) return;
  const p = driverPayload(req.body ?? {});
  if (!p.name || (p.phone.replace(/\D/g, "").length < 7)) { res.status(400).json({ error: "Driver name and a valid phone are required" }); return; }
  const [d] = await db.insert(driversTable).values(p).returning();
  void logAudit({ actorId: req.user!.id, action: "driver.created", entityType: "driver", entityId: d!.id, details: { name: d!.name } });
  res.status(201).json(d);
});

router.put("/drivers/:id", requireAuth, async (req: AuthRequest, res) => {
  if (!leadOnly(req, res)) return;
  const id = Number(req.params.id);
  const p = driverPayload(req.body ?? {});
  if (!p.name || p.phone.replace(/\D/g, "").length < 7) { res.status(400).json({ error: "Driver name and a valid phone are required" }); return; }
  const [d] = await db.update(driversTable).set(p).where(eq(driversTable.id, id)).returning();
  if (!d) { res.status(404).json({ error: "Not found" }); return; }
  void logAudit({ actorId: req.user!.id, action: "driver.updated", entityType: "driver", entityId: id });
  res.json(d);
});

router.get("/drivers/:id/history", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const r = await db.execute(sql`
    SELECT e.id, e.status, e.note, e.created_at, o.order_number, o.id AS order_id, c.name AS customer_name, COALESCE(u.display_name, u.name) AS actor
    FROM delivery_events e
    JOIN delivery_orders o ON o.id = e.order_id
    JOIN customers c ON c.id = o.customer_id
    LEFT JOIN users u ON u.id = e.actor_id
    WHERE e.driver_id = ${id} OR o.driver_id = ${id}
    ORDER BY e.id DESC LIMIT 200`);
  res.json(r.rows ?? []);
});

// ── Orders ──────────────────────────────────────────────────────────────────

const orderSelect = sql`
  SELECT o.*, c.name AS customer_name, c.phone AS customer_phone, d.name AS driver_name, d.phone AS driver_phone,
         COALESCE(u.display_name, u.name) AS created_by_name
  FROM delivery_orders o
  JOIN customers c ON c.id = o.customer_id
  LEFT JOIN drivers d ON d.id = o.driver_id
  LEFT JOIN users u ON u.id = o.created_by`;

router.get("/deliveries", requireAuth, requirePermission("canViewChats"), async (req, res) => {
  const q = req.query as Record<string, string>;
  const conds = [sql`TRUE`];
  if (q.status === "active") conds.push(sql`o.status IN ('new','assigned','picked_up','on_the_way')`);
  else if (q.status && (DELIVERY_STATUSES as readonly string[]).includes(q.status)) conds.push(sql`o.status = ${q.status}`);
  if (Number(q.driverId)) conds.push(sql`o.driver_id = ${Number(q.driverId)}`);
  if (Number(q.groupId)) conds.push(sql`d.group_id = ${Number(q.groupId)}`);
  if (Number(q.customerId)) conds.push(sql`o.customer_id = ${Number(q.customerId)}`);
  if (q.q) { const like = `%${q.q}%`; conds.push(sql`(o.order_number ILIKE ${like} OR c.name ILIKE ${like} OR c.phone ILIKE ${like} OR o.address ILIKE ${like})`); }
  const r = await db.execute(sql`${orderSelect} WHERE ${sql.join(conds, sql` AND `)} ORDER BY o.id DESC LIMIT 500`);
  const counts = await db.execute(sql`SELECT status, COUNT(*)::int AS n FROM delivery_orders GROUP BY status`);
  res.json({ orders: r.rows ?? [], counts: Object.fromEntries(((counts.rows ?? []) as { status: string; n: number }[]).map((x) => [x.status, x.n])) });
});

router.get("/deliveries/:id", requireAuth, requirePermission("canViewChats"), async (req, res) => {
  const id = Number(req.params.id);
  const r = await db.execute(sql`${orderSelect} WHERE o.id = ${id}`);
  const order = (r.rows ?? [])[0];
  if (!order) { res.status(404).json({ error: "Not found" }); return; }
  const ev = await db.execute(sql`
    SELECT e.*, d.name AS driver_name, COALESCE(u.display_name, u.name) AS actor
    FROM delivery_events e LEFT JOIN drivers d ON d.id = e.driver_id LEFT JOIN users u ON u.id = e.actor_id
    WHERE e.order_id = ${id} ORDER BY e.id`);
  res.json({ ...order, events: ev.rows ?? [] });
});

async function nextOrderNumber(): Promise<string> {
  const r = await db.execute(sql`SELECT COALESCE(MAX(id), 0) + 1 AS n FROM delivery_orders`);
  const n = Number(((r.rows ?? [])[0] as { n: number }).n);
  return `D-${String(n).padStart(5, "0")}`;
}

/** Internal note in the chat (+ optional customer message) for an order event. */
async function tellConversation(orderId: number, text: string, notify: string | null, actorId: number, io?: IOServer) {
  const [o] = await db.select({ conversationId: deliveryOrdersTable.conversationId }).from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, orderId));
  if (!o?.conversationId) return;
  const [note] = await db.insert(messagesTable).values({ conversationId: o.conversationId, senderId: actorId, senderType: "system", body: text, isNote: true, status: "sent" }).returning();
  io?.to(`conv:${o.conversationId}`).emit("new_message", note);
  if (notify && outboundEnabled()) {
    const [m] = await db.insert(messagesTable).values({ conversationId: o.conversationId, senderId: actorId, senderType: "agent", body: notify, status: "sent" }).returning();
    const { delivered } = await deliverToCustomer(o.conversationId, m!);
    await db.update(conversationsTable).set({ lastMessage: notify, lastMessageAt: new Date(), lastSenderType: "agent" }).where(eq(conversationsTable.id, o.conversationId));
    io?.to(`conv:${o.conversationId}`).emit("new_message", delivered);
  }
  io?.emit("conversation_updated", { conversationId: o.conversationId });
}

router.post("/deliveries", requireAuth, requirePermission("canManageCustomers"), async (req: AuthRequest, res) => {
  const b = req.body ?? {};
  const customerId = Number(b.customerId);
  const [cust] = await db.select({ id: customersTable.id, address: customersTable.address }).from(customersTable).where(eq(customersTable.id, customerId));
  if (!cust) { res.status(400).json({ error: "Choose the customer" }); return; }
  const conversationId = Number.isInteger(b.conversationId) ? (b.conversationId as number) : null;
  if (conversationId) {
    const [c] = await db.select({ customerId: conversationsTable.customerId }).from(conversationsTable).where(eq(conversationsTable.id, conversationId));
    if (!c || c.customerId !== customerId) { res.status(400).json({ error: "That conversation belongs to another customer" }); return; }
  }
  const amount = b.amount === undefined || b.amount === null || b.amount === "" ? null : Number(b.amount);
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) { res.status(400).json({ error: "Amount must be a positive number" }); return; }
  const driverId = Number.isInteger(b.driverId) ? (b.driverId as number) : null;
  let orderNumber = str(b.orderNumber, 40) ?? (await nextOrderNumber());
  try {
    const [o] = await db.insert(deliveryOrdersTable).values({
      orderNumber, customerId, conversationId, driverId,
      status: driverId ? "assigned" : "new",
      address: str(b.address, 500) ?? cust.address, notes: str(b.notes, 1000),
      amount: amount === null ? null : amount.toFixed(2),
      scheduledFor: b.scheduledFor && !Number.isNaN(Date.parse(b.scheduledFor)) ? new Date(b.scheduledFor) : null,
      createdBy: req.user!.id,
    }).returning();
    orderNumber = o!.orderNumber;
    await db.insert(deliveryEventsTable).values({ orderId: o!.id, status: o!.status, driverId, actorId: req.user!.id, note: "Order created" });
    if (driverId) await db.update(driversTable).set({ status: "on_delivery" }).where(eq(driversTable.id, driverId));
    await tellConversation(o!.id, `Delivery order ${orderNumber} created${driverId ? " and assigned to a driver" : ""}.`, null, req.user!.id, req.app.get("io"));
    res.status(201).json(o);
  } catch {
    res.status(409).json({ error: "This order number already exists" });
  }
});

router.patch("/deliveries/:id", requireAuth, requirePermission("canManageCustomers"), async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const [o] = await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, id));
  if (!o) { res.status(404).json({ error: "Not found" }); return; }
  const b = req.body ?? {};
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  let status = o.status as DeliveryStatus;
  let driverId = o.driverId;
  if (b.driverId !== undefined) {
    driverId = Number.isInteger(b.driverId) ? (b.driverId as number) : null;
    if (driverId) {
      const [d] = await db.select({ isActive: driversTable.isActive }).from(driversTable).where(eq(driversTable.id, driverId));
      if (!d?.isActive) { res.status(400).json({ error: "That driver is not active" }); return; }
    }
    updates.driverId = driverId;
    if (driverId && status === "new") status = "assigned";
    if (!driverId && ACTIVE.includes(status)) status = "new";
  }
  if (b.status !== undefined) {
    if (!(DELIVERY_STATUSES as readonly string[]).includes(b.status)) { res.status(400).json({ error: "Unknown status" }); return; }
    status = b.status;
    if (ACTIVE.includes(status) && !driverId) { res.status(400).json({ error: "Assign a driver first" }); return; }
  }
  if (b.address !== undefined) updates.address = str(b.address, 500);
  if (b.notes !== undefined) updates.notes = str(b.notes, 1000);
  updates.status = status;
  if (status === "delivered" && o.status !== "delivered") updates.deliveredAt = new Date();
  await db.update(deliveryOrdersTable).set(updates).where(eq(deliveryOrdersTable.id, id));

  const changed = status !== o.status || driverId !== o.driverId;
  if (changed || b.note) {
    await db.insert(deliveryEventsTable).values({ orderId: id, status, driverId, actorId: req.user!.id, note: str(b.note, 500) });
  }
  // Driver availability follows their active orders.
  for (const d of [...new Set([o.driverId, driverId].filter((x): x is number => !!x))]) {
    const [{ n }] = (await db.execute(sql`SELECT COUNT(*)::int AS n FROM delivery_orders WHERE driver_id = ${d} AND status IN ('assigned','picked_up','on_the_way')`)).rows as { n: number }[];
    await db.execute(sql`UPDATE drivers SET status = CASE WHEN ${n} > 0 THEN 'on_delivery' WHEN status = 'off' THEN 'off' ELSE 'available' END WHERE id = ${d}`);
  }
  if (changed) {
    const [drv] = driverId ? await db.select({ name: driversTable.name, phone: driversTable.phone }).from(driversTable).where(eq(driversTable.id, driverId)) : [];
    const internal = `Delivery ${o.orderNumber} ${LABEL[status]}${drv ? ` — driver ${drv.name}` : ""}${b.note ? ` (${str(b.note, 200)})` : ""}.`;
    const notify = b.notifyCustomer === true
      ? (status === "on_the_way" && drv ? `Your order ${o.orderNumber} is on the way with ${drv.name} (${drv.phone}).` : `Update on your order ${o.orderNumber}: ${LABEL[status]}.`)
      : null;
    await tellConversation(id, internal, notify, req.user!.id, req.app.get("io"));
    void logAudit({ actorId: req.user!.id, action: "delivery.updated", entityType: "delivery", entityId: id, details: { from: o.status, to: status, driverId } });
  }
  const r = await db.execute(sql`${orderSelect} WHERE o.id = ${id}`);
  res.json((r.rows ?? [])[0]);
});

export default router;
