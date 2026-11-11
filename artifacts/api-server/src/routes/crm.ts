/**
 * CRM extras: custom customer fields, CSV import/export, duplicate detection
 * and merge, and the customer activity timeline.
 */
import { Router } from "express";
import { asc, eq, sql } from "drizzle-orm";
import { db, customersTable, customerFieldsTable } from "@workspace/db";
import { requireAuth, requireAdmin, type AuthRequest } from "../middlewares/auth";
import { requirePermission } from "../middlewares/permissions";
import { csvCell, parseCsv, phoneKey } from "../lib/csv";
import { logAudit } from "../lib/audit";

const router = Router();

// ── Custom fields ───────────────────────────────────────────────────────────

router.get("/customer-fields", requireAuth, async (_req, res) => {
  res.json(await db.select().from(customerFieldsTable).orderBy(asc(customerFieldsTable.sortOrder), asc(customerFieldsTable.id)));
});

router.post("/customer-fields", requireAuth, requireAdmin, async (req, res) => {
  const label = typeof req.body?.label === "string" ? req.body.label.trim().slice(0, 60) : "";
  if (!label) { res.status(400).json({ error: "label required" }); return; }
  const key = (typeof req.body?.key === "string" && req.body.key.trim() ? req.body.key : label)
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || `field_${Date.now()}`;
  const type = ["text", "number", "date", "select"].includes(req.body?.type) ? req.body.type : "text";
  const options = Array.isArray(req.body?.options) ? req.body.options.map((o: unknown) => String(o).trim()).filter(Boolean).slice(0, 50) : [];
  if (type === "select" && options.length === 0) { res.status(400).json({ error: "A list field needs at least one option" }); return; }
  try {
    const [row] = await db.insert(customerFieldsTable).values({ key, label, type, options, sortOrder: Number(req.body?.sortOrder) || 0 }).returning();
    res.status(201).json(row);
  } catch {
    res.status(409).json({ error: "A field with this key already exists" });
  }
});

router.delete("/customer-fields/:id", requireAuth, requireAdmin, async (req, res) => {
  // Values already stored on customers are kept (still exported), just not shown.
  await db.delete(customerFieldsTable).where(eq(customerFieldsTable.id, Number(req.params.id)));
  res.status(204).send();
});

/** Keep only defined fields, coerced to their type. */
export async function cleanCustomFields(input: unknown): Promise<Record<string, string>> {
  const defs = await db.select().from(customerFieldsTable);
  const out: Record<string, string> = {};
  if (!input || typeof input !== "object") return out;
  for (const d of defs) {
    const raw = (input as Record<string, unknown>)[d.key];
    if (raw === undefined || raw === null) continue;
    const v = String(raw).trim().slice(0, 500);
    if (!v) continue;
    if (d.type === "number" && !Number.isFinite(Number(v))) continue;
    if (d.type === "date" && Number.isNaN(Date.parse(v))) continue;
    if (d.type === "select" && !d.options.includes(v)) continue;
    out[d.key] = v;
  }
  return out;
}

// ── Export ──────────────────────────────────────────────────────────────────

router.get("/customers/export.csv", requireAuth, requirePermission("canManageCustomers"), async (req: AuthRequest, res) => {
  const defs = await db.select().from(customerFieldsTable).orderBy(asc(customerFieldsTable.sortOrder));
  const rows = await db.execute(sql`
    SELECT c.*, (SELECT COUNT(*)::int FROM conversations v WHERE v.customer_id = c.id) AS conversations,
           (SELECT MAX(v.last_message_at) FROM conversations v WHERE v.customer_id = c.id) AS last_activity
    FROM customers c ORDER BY c.id
  `);
  const head = ["id", "name", "phone", "email", "branch", "address", "tags", "notes", "messenger_psid", "instagram_id", "blocked", "conversations", "last_activity", "created_at", ...defs.map((d) => d.key)];
  const lines = [head.join(",")];
  for (const r of (rows.rows ?? []) as Record<string, unknown>[]) {
    const cf = (r["custom_fields"] ?? {}) as Record<string, string>;
    lines.push([
      r["id"], r["name"], r["phone"], r["email"], r["branch"], r["address"], r["tags"], r["notes"], r["messenger_psid"], r["instagram_id"],
      r["is_blocked"] ? "yes" : "", r["conversations"], r["last_activity"] ? new Date(r["last_activity"] as string).toISOString() : "",
      new Date(r["created_at"] as string).toISOString(), ...defs.map((d) => cf[d.key] ?? ""),
    ].map(csvCell).join(","));
  }
  void logAudit({ actorId: req.user!.id, action: "customers.exported", entityType: "customer", details: { rows: lines.length - 1 } });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="customers-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send("﻿" + lines.join("\r\n"));
});

// ── Import ──────────────────────────────────────────────────────────────────

const HEADER_ALIASES: Record<string, string> = {
  name: "name", "full name": "name", الاسم: "name",
  phone: "phone", mobile: "phone", "phone number": "phone", الهاتف: "phone", الموبايل: "phone",
  email: "email", "e-mail": "email",
  branch: "branch", address: "address", العنوان: "address",
  tags: "tags", lists: "tags", notes: "notes", ملاحظات: "notes",
};

router.post("/customers/import", requireAuth, requirePermission("canManageCustomers"), async (req: AuthRequest, res) => {
  const text = typeof req.body?.csv === "string" ? req.body.csv : "";
  const mode = req.body?.mode === "update" ? "update" : "skip";
  if (!text.trim()) { res.status(400).json({ error: "Paste or upload a CSV file" }); return; }
  const rows = parseCsv(text);
  if (rows.length < 2) { res.status(400).json({ error: "The file needs a header row and at least one customer" }); return; }
  if (rows.length > 5001) { res.status(400).json({ error: "Import up to 5,000 customers at a time" }); return; }
  const defs = await db.select().from(customerFieldsTable);
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.findIndex((h) => HEADER_ALIASES[h] === name);
  const idx = { name: col("name"), phone: col("phone"), email: col("email"), branch: col("branch"), address: col("address"), tags: col("tags"), notes: col("notes") };
  if (idx.phone < 0) { res.status(400).json({ error: "The file needs a 'phone' column" }); return; }
  const customIdx = defs.map((d) => ({ d, i: header.findIndex((h) => h === d.key || h === d.label.toLowerCase()) })).filter((x) => x.i >= 0);

  // Existing customers by phone key (one query, not one per row).
  const existing = await db.select({ id: customersTable.id, phone: customersTable.phone }).from(customersTable);
  const byKey = new Map(existing.filter((e) => phoneKey(e.phone)).map((e) => [phoneKey(e.phone), e.id]));

  let created = 0, updated = 0, skipped = 0;
  const errors: { row: number; error: string }[] = [];
  for (let n = 1; n < rows.length; n++) {
    const r = rows[n]!;
    const get = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const phone = get(idx.phone);
    const key = phoneKey(phone);
    if (key.length < 7) { errors.push({ row: n + 1, error: "missing or invalid phone" }); continue; }
    const cf: Record<string, string> = {};
    for (const { d, i } of customIdx) {
      const v = get(i).slice(0, 500);
      if (!v) continue;
      if (d.type === "number" && !Number.isFinite(Number(v))) continue;
      if (d.type === "date" && Number.isNaN(Date.parse(v))) continue;
      if (d.type === "select" && !d.options.includes(v)) continue;
      cf[d.key] = v;
    }
    const email = get(idx.email).toLowerCase();
    const values = {
      name: get(idx.name),
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
      branch: get(idx.branch) || null,
      address: get(idx.address) || null,
      notes: get(idx.notes) || null,
      tags: get(idx.tags) ? get(idx.tags).split(/[;|،]/).map((t) => t.trim()).filter(Boolean).slice(0, 20) : [],
    };
    const dup = byKey.get(key);
    if (dup) {
      if (mode === "skip") { skipped++; continue; }
      // Update: only fill what the file provides; never blank out existing data.
      const set: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) if (k !== "tags" && v) set[k] = v;
      if (values.tags.length) {
        const arr = sql`ARRAY[${sql.join(values.tags.map((t) => sql`${t}`), sql`, `)}]::text[]`;
        set["tags"] = sql`(SELECT ARRAY(SELECT DISTINCT unnest(${customersTable.tags} || ${arr})))`;
      }
      if (Object.keys(cf).length) set["customFields"] = sql`COALESCE(${customersTable.customFields}, '{}'::jsonb) || ${JSON.stringify(cf)}::jsonb`;
      if (Object.keys(set).length) await db.update(customersTable).set(set).where(eq(customersTable.id, dup));
      updated++;
    } else {
      const [row] = await db.insert(customersTable).values({ ...values, name: values.name || phone, phone, customFields: Object.keys(cf).length ? cf : null }).returning({ id: customersTable.id });
      byKey.set(key, row!.id);
      created++;
    }
  }
  void logAudit({ actorId: req.user!.id, action: "customers.imported", entityType: "customer", details: { created, updated, skipped, errors: errors.length } });
  res.json({ created, updated, skipped, errors: errors.slice(0, 50), totalErrors: errors.length });
});

// ── Duplicates & merge ──────────────────────────────────────────────────────

router.get("/customers/duplicates", requireAuth, requirePermission("canManageCustomers"), async (_req, res) => {
  const r = await db.execute(sql`
    WITH k AS (
      SELECT id, name, phone, email, created_at,
        CASE WHEN length(regexp_replace(phone, '\\D', '', 'g')) >= 10 THEN right(regexp_replace(phone, '\\D', '', 'g'), 10)
             ELSE NULLIF(regexp_replace(phone, '\\D', '', 'g'), '') END AS pkey,
        NULLIF(lower(trim(email)), '') AS ekey
      FROM customers
    ),
    g AS (
      SELECT 'phone' AS reason, pkey AS key, array_agg(id ORDER BY created_at) AS ids FROM k WHERE pkey IS NOT NULL GROUP BY pkey HAVING COUNT(*) > 1
      UNION ALL
      SELECT 'email', ekey, array_agg(id ORDER BY created_at) FROM k WHERE ekey IS NOT NULL GROUP BY ekey HAVING COUNT(*) > 1
    )
    SELECT g.reason, g.key,
      json_agg(json_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email, 'createdAt', c.created_at,
        'conversations', (SELECT COUNT(*) FROM conversations v WHERE v.customer_id = c.id)) ORDER BY c.created_at) AS customers
    FROM g JOIN customers c ON c.id = ANY(g.ids)
    GROUP BY g.reason, g.key
    ORDER BY g.reason, g.key
    LIMIT 200
  `);
  res.json(r.rows ?? []);
});

/** Merge `sourceId` into `:id`: conversations move over, empty fields are filled, the source is removed. */
router.post("/customers/:id/merge", requireAuth, requirePermission("canManageCustomers"), async (req: AuthRequest, res) => {
  const targetId = Number(req.params.id);
  const sourceId = Number(req.body?.sourceId);
  if (!Number.isInteger(sourceId) || sourceId === targetId) { res.status(400).json({ error: "Choose a different customer to merge" }); return; }
  const [t] = await db.select().from(customersTable).where(eq(customersTable.id, targetId));
  const [s] = await db.select().from(customersTable).where(eq(customersTable.id, sourceId));
  if (!t || !s) { res.status(404).json({ error: "Customer not found" }); return; }

  await db.transaction(async (tx) => {
    const moved = await tx.execute(sql`UPDATE conversations SET customer_id = ${targetId} WHERE customer_id = ${sourceId}`);
    await tx.execute(sql`UPDATE campaign_recipients SET customer_id = ${targetId} WHERE customer_id = ${sourceId}
      AND NOT EXISTS (SELECT 1 FROM campaign_recipients x WHERE x.customer_id = ${targetId} AND x.campaign_id = campaign_recipients.campaign_id)`);
    // Free unique social ids before copying them to the target.
    await tx.update(customersTable).set({ messengerPsid: null, instagramId: null }).where(eq(customersTable.id, sourceId));
    const notes = [t.notes, s.notes].filter(Boolean).join("\n—\n") || null;
    await tx.update(customersTable).set({
      phone: t.phone || s.phone,
      email: t.email || s.email,
      branch: t.branch || s.branch,
      address: t.address || s.address,
      notes,
      prescriptionNotes: [t.prescriptionNotes, s.prescriptionNotes].filter(Boolean).join("\n—\n") || null,
      tags: [...new Set([...(t.tags ?? []), ...(s.tags ?? [])])],
      messengerPsid: t.messengerPsid || s.messengerPsid,
      instagramId: t.instagramId || s.instagramId,
      customFields: { ...(s.customFields ?? {}), ...(t.customFields ?? {}) },
      // Keep a real name over an auto-generated one.
      name: /^\+?[\d\s-]+$|^(Messenger|Instagram) user /.test(t.name) && !/^\+?[\d\s-]+$/.test(s.name) ? s.name : t.name,
      isBlocked: t.isBlocked || s.isBlocked,
    }).where(eq(customersTable.id, targetId));
    await tx.delete(customersTable).where(eq(customersTable.id, sourceId));
    void logAudit({
      actorId: req.user!.id, action: "customers.merged", entityType: "customer", entityId: targetId,
      details: { sourceId, sourceName: s.name, conversationsMoved: Number((moved as { rowCount?: number }).rowCount ?? 0) },
    });
  });
  const [merged] = await db.select().from(customersTable).where(eq(customersTable.id, targetId));
  res.json(merged);
});

// ── Timeline ────────────────────────────────────────────────────────────────

router.get("/customers/:id/timeline", requireAuth, requirePermission("canViewChats"), async (req, res) => {
  const id = Number(req.params.id);
  const r = await db.execute(sql`
    SELECT * FROM (
      SELECT 'customer_created' AS type, c.created_at AS at, NULL::int AS conversation_id, NULL AS channel, NULL AS text, NULL AS actor
        FROM customers c WHERE c.id = ${id}
      UNION ALL
      SELECT 'conversation_started', v.created_at, v.id, v.channel, NULL, COALESCE(u.display_name, u.name)
        FROM conversations v LEFT JOIN users u ON u.id = v.assigned_agent_id WHERE v.customer_id = ${id}
      UNION ALL
      SELECT 'conversation_resolved', v.resolved_at, v.id, v.channel, NULL, NULL
        FROM conversations v WHERE v.customer_id = ${id} AND v.resolved_at IS NOT NULL
      UNION ALL
      SELECT CASE WHEN m.is_note THEN 'note' WHEN m.template_id IS NOT NULL THEN 'template_sent' ELSE 'last_customer_message' END,
             m.created_at, m.conversation_id, v.channel, LEFT(m.body, 200), COALESCE(u.display_name, u.name)
        FROM messages m JOIN conversations v ON v.id = m.conversation_id LEFT JOIN users u ON u.id = m.sender_id
        WHERE v.customer_id = ${id} AND (m.is_note OR m.template_id IS NOT NULL OR m.id IN (
          SELECT MAX(m2.id) FROM messages m2 WHERE m2.conversation_id = m.conversation_id AND m2.sender_type = 'customer'))
      UNION ALL
      SELECT a.action, a.created_at, a.entity_id, NULL, NULL, COALESCE(u.display_name, u.name)
        FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.entity_type = 'conversation' AND a.action IN ('conversation.assigned','conversation.takeover','conversation.takeover_released')
          AND a.entity_id IN (SELECT id FROM conversations WHERE customer_id = ${id})
    ) t WHERE at IS NOT NULL ORDER BY at DESC LIMIT 200
  `);
  res.json(r.rows ?? []);
});

export default router;
