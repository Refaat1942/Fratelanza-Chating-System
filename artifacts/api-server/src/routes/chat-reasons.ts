import { Router } from "express";
import { db } from "@workspace/db";
import { chatReasonsTable, chatReasonCategoriesTable, conversationsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { reclassifyAll } from "../lib/topics";
import { logger } from "../lib/logger";

/** Accept an array or a comma/newline separated string; trim, dedupe, cap. */
function cleanKeywords(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,،\n]/) : [];
  const out: string[] = [];
  for (const k of list) {
    const t = String(k).trim().slice(0, 60);
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.slice(0, 100);
}

function refile() {
  void reclassifyAll().catch((err) => logger.error({ err }, "topics: re-filing failed"));
}

const router = Router();

router.get("/chat-reasons", requireAuth, async (_req, res) => {
  const rows = await db
    .select({
      id: chatReasonsTable.id,
      nameAr: chatReasonsTable.nameAr,
      nameEn: chatReasonsTable.nameEn,
      color: chatReasonsTable.color,
      categoryId: chatReasonsTable.categoryId,
      isActive: chatReasonsTable.isActive,
      keywords: chatReasonsTable.keywords,
      createdAt: chatReasonsTable.createdAt,
      categoryTitleEn: chatReasonCategoriesTable.titleEn,
      categoryTitleAr: chatReasonCategoriesTable.titleAr,
    })
    .from(chatReasonsTable)
    .leftJoin(
      chatReasonCategoriesTable,
      eq(chatReasonsTable.categoryId, chatReasonCategoriesTable.id),
    )
    .orderBy(asc(chatReasonsTable.id));
  res.json(rows);
});

router.post("/chat-reasons", requireAuth, requireAdmin, async (req, res) => {
  const { nameAr, nameEn, color, categoryId, isActive, keywords } = req.body || {};
  if (typeof nameAr !== "string" || typeof nameEn !== "string" || !nameAr.trim() || !nameEn.trim()) {
    res.status(400).json({ error: "nameAr and nameEn are required" });
    return;
  }
  const [row] = await db.insert(chatReasonsTable).values({
    nameAr: nameAr.trim(),
    nameEn: nameEn.trim(),
    color: typeof color === "string" && color.trim() ? color.trim() : "#FCA5A5",
    categoryId: typeof categoryId === "number" ? categoryId : null,
    isActive: typeof isActive === "boolean" ? isActive : true,
    keywords: cleanKeywords(keywords) ?? [],
  }).returning();
  if (row.keywords.length) refile();
  res.status(201).json(row);
});

router.put("/chat-reasons/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { nameAr, nameEn, color, categoryId, isActive, keywords } = req.body || {};
  const updates: Record<string, unknown> = {};
  if (typeof nameAr === "string") updates.nameAr = nameAr.trim();
  if (typeof nameEn === "string") updates.nameEn = nameEn.trim();
  if (typeof color === "string") updates.color = color.trim();
  if (categoryId === null || typeof categoryId === "number") updates.categoryId = categoryId;
  if (typeof isActive === "boolean") updates.isActive = isActive;
  const kw = cleanKeywords(keywords);
  if (kw !== undefined) updates.keywords = kw;
  const [row] = await db.update(chatReasonsTable)
    .set(updates)
    .where(eq(chatReasonsTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (kw !== undefined || typeof isActive === "boolean") refile();
  res.json(row);
});

// Re-file every chat that a person has not filed by hand.
router.post("/chat-reasons/reclassify", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await reclassifyAll());
});

router.delete("/chat-reasons/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  // Chats in a deleted topic become unsorted (and may be re-sorted automatically).
  await db.update(conversationsTable).set({ chatReasonId: null, chatReasonAuto: false }).where(eq(conversationsTable.chatReasonId, id));
  await db.delete(chatReasonsTable).where(eq(chatReasonsTable.id, id));
  refile();
  res.status(204).send();
});

export default router;
