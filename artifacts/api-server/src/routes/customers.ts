import { Router } from "express";
import { db } from "@workspace/db";
import { customersTable, conversationsTable } from "@workspace/db";
import { eq, ilike, sql, and, or, SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission } from "../middlewares/permissions";
import { cleanCustomFields } from "./crm";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const router = Router();

router.get("/customers", requireAuth, async (req, res) => {
  const { search, tag, branch, segment, channel } = req.query as Record<string, string>;

  const conditions: SQL[] = [];
  if (search) {
    // Match across name, phone, and any tag — matches the UI hint
    // "Search by name, phone, or tags".
    const like = `%${search}%`;
    const tagMatch = sql<boolean>`EXISTS (
      SELECT 1 FROM unnest(${customersTable.tags}) t
      WHERE t ILIKE ${like}
    )`;
    const combined = or(
      ilike(customersTable.name, like),
      ilike(customersTable.phone, like),
      ilike(customersTable.email, like),
      tagMatch,
    );
    if (combined) conditions.push(combined);
  }
  if (branch) conditions.push(eq(customersTable.branch, branch));
  if (tag) conditions.push(sql`${customersTable.tags} @> ARRAY[${tag}]::text[]`);
  // Segments (all computed from real data).
  const convCount = sql`(SELECT COUNT(*) FROM conversations v WHERE v.customer_id = ${customersTable.id})`;
  const lastAct = sql`(SELECT MAX(v.last_message_at) FROM conversations v WHERE v.customer_id = ${customersTable.id})`;
  if (segment === "new") conditions.push(sql`${customersTable.createdAt} > NOW() - INTERVAL '30 days'`);
  if (segment === "returning") conditions.push(sql`${convCount} >= 2`);
  if (segment === "inactive") conditions.push(sql`COALESCE(${lastAct}, ${customersTable.createdAt}) < NOW() - INTERVAL '60 days'`);
  if (segment === "blocked") conditions.push(eq(customersTable.isBlocked, true));
  if (channel && ["whatsapp", "messenger", "instagram", "sms", "web"].includes(channel)) {
    conditions.push(sql`EXISTS (SELECT 1 FROM conversations v WHERE v.customer_id = ${customersTable.id} AND v.channel = ${channel})`);
  }

  const customers = await db.select({
    customer: customersTable,
    conversationCount: sql<number>`${convCount}::int`,
    lastActivity: lastAct,
  }).from(customersTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(customersTable.createdAt)
    .then((rows) => rows.map((r) => ({ ...r.customer, conversationCount: r.conversationCount, lastActivity: r.lastActivity })));

  res.json(customers);
});

router.post("/customers", requireAuth, requirePermission("canManageCustomers"), async (req, res) => {
  const { name, phone, branch, address, tags, notes, prescriptionNotes, email, customFields } = req.body;
  if (email && !EMAIL_RE.test(String(email).trim())) { res.status(400).json({ error: "Enter a valid email address" }); return; }
  // Stronger validation — names need to be non-empty, phones need to look
  // like a phone (7+ digits, allow + - space ()). Prevents junk records.
  const nameStr = typeof name === "string" ? name.trim() : "";
  const phoneStr = typeof phone === "string" ? phone.trim() : "";
  if (nameStr.length < 2) {
    res.status(400).json({ error: "name must be at least 2 characters" });
    return;
  }
  const phoneDigits = phoneStr.replace(/[^\d]/g, "");
  if (phoneDigits.length < 7) {
    res.status(400).json({ error: "phone must contain at least 7 digits" });
    return;
  }
  if (!/^[\d\s+\-()]+$/.test(phoneStr)) {
    res.status(400).json({ error: "phone contains invalid characters" });
    return;
  }
  const [customer] = await db.insert(customersTable).values({
    name: nameStr,
    phone: phoneStr,
    branch: branch || null,
    address: address ? String(address).trim() || null : null,
    tags: Array.isArray(tags) ? tags : [],
    notes: notes || null,
    prescriptionNotes: prescriptionNotes || null,
    email: email ? String(email).trim().toLowerCase() : null,
    customFields: customFields ? await cleanCustomFields(customFields) : null,
  }).returning();
  res.status(201).json(customer);
});

router.get("/customers/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, id));
  if (!customer) { res.status(404).json({ error: "Not found" }); return; }
  res.json(customer);
});

router.put("/customers/:id", requireAuth, requirePermission("canManageCustomers"), async (req, res) => {
  const id = Number(req.params.id);
  const { name, phone, branch, address, tags, notes, prescriptionNotes, email, customFields } = req.body;
  const updates: Record<string, unknown> = {};
  if (email !== undefined) {
    const e = String(email ?? "").trim().toLowerCase();
    if (e && !EMAIL_RE.test(e)) { res.status(400).json({ error: "Enter a valid email address" }); return; }
    updates.email = e || null;
  }
  if (customFields !== undefined) updates.customFields = await cleanCustomFields(customFields);
  if (name !== undefined) updates.name = name;
  if (phone !== undefined) updates.phone = phone;
  if (branch !== undefined) updates.branch = branch;
  if (address !== undefined) updates.address = address || null;
  if (tags !== undefined) updates.tags = tags;
  if (notes !== undefined) updates.notes = notes;
  if (prescriptionNotes !== undefined) updates.prescriptionNotes = prescriptionNotes;
  const [customer] = await db.update(customersTable).set(updates).where(eq(customersTable.id, id)).returning();
  if (!customer) { res.status(404).json({ error: "Not found" }); return; }
  res.json(customer);
});

router.delete("/customers/:id", requireAuth, requirePermission("canManageCustomers"), async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(customersTable).where(eq(customersTable.id, id));
  res.status(204).send();
});

// Block / unblock a customer. Blocking prevents agents from sending new
// outbound messages to any of the customer's conversations (see messages.ts).
// Internal notes are still allowed so staff can record context.
router.post("/customers/:id/block", requireAuth, requirePermission("canManageCustomers"), async (req, res) => {
  const id = Number(req.params.id);
  const reason = typeof req.body?.reason === "string"
    ? req.body.reason.trim().slice(0, 500) || null
    : null;
  const [customer] = await db.update(customersTable)
    .set({ isBlocked: true, blockedReason: reason, blockedAt: new Date() })
    .where(eq(customersTable.id, id))
    .returning();
  if (!customer) { res.status(404).json({ error: "Not found" }); return; }
  res.json(customer);
});

router.post("/customers/:id/unblock", requireAuth, requirePermission("canManageCustomers"), async (req, res) => {
  const id = Number(req.params.id);
  const [customer] = await db.update(customersTable)
    .set({ isBlocked: false, blockedReason: null, blockedAt: null })
    .where(eq(customersTable.id, id))
    .returning();
  if (!customer) { res.status(404).json({ error: "Not found" }); return; }
  res.json(customer);
});

router.get("/customers/:id/conversations", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const conversations = await db.select({
    id: conversationsTable.id,
    customerId: conversationsTable.customerId,
    assignedAgentId: conversationsTable.assignedAgentId,
    status: conversationsTable.status,
    tags: conversationsTable.tags,
    lastMessage: conversationsTable.lastMessage,
    lastMessageAt: conversationsTable.lastMessageAt,
    unreadCount: conversationsTable.unreadCount,
    createdAt: conversationsTable.createdAt,
    resolvedAt: conversationsTable.resolvedAt,
    customer: {
      id: customersTable.id,
      name: customersTable.name,
      phone: customersTable.phone,
      branch: customersTable.branch,
      tags: customersTable.tags,
      notes: customersTable.notes,
      prescriptionNotes: customersTable.prescriptionNotes,
      createdAt: customersTable.createdAt,
    },
  }).from(conversationsTable)
    .leftJoin(customersTable, eq(conversationsTable.customerId, customersTable.id))
    .where(eq(conversationsTable.customerId, id))
    .orderBy(conversationsTable.createdAt);
  res.json(conversations);
});

export default router;
