/**
 * Content topics: files every conversation under a topic ("Pricing", "Support",
 * …) by matching the customer's own words against per-topic keywords (English
 * and Egyptian/Modern Standard Arabic). Deterministic, free and explainable —
 * no external AI call.
 *
 * Topics live in `chat_reasons` (+ `keywords`). A topic picked by a person is
 * never overridden; one picked by the classifier (`chat_reason_auto`) is
 * re-evaluated whenever the customer writes again or the keywords change.
 */
import { and, desc, eq, or, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { chatReasonsTable, conversationsTable, messagesTable, settingsTable } from "@workspace/db";
import { logger } from "./logger";

/** Lower-case, strip Arabic diacritics/tatweel and unify letter variants. */
export function normalizeText(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface TopicRule {
  id: number;
  matchers: ((text: string) => number)[];
}

/** Latin keywords match whole words ("hr" must not hit "three"); Arabic ones
 *  match inside words, because Arabic attaches prefixes (ال، و، ب، ف). */
function compileKeyword(raw: string): ((text: string) => number) | null {
  const k = normalizeText(raw);
  if (k.length < 2) return null;
  if (/^[a-z0-9 .+#-]+$/.test(k)) {
    const re = new RegExp(`(^|[^a-z0-9])${escapeRe(k)}(?=$|[^a-z0-9])`, "g");
    return (t) => (t.match(re)?.length ?? 0);
  }
  return (t) => {
    let n = 0;
    let i = t.indexOf(k);
    while (i !== -1) { n++; i = t.indexOf(k, i + k.length); }
    return n;
  };
}

export async function loadTopicRules(): Promise<TopicRule[]> {
  const rows = await db
    .select({ id: chatReasonsTable.id, keywords: chatReasonsTable.keywords })
    .from(chatReasonsTable)
    .where(eq(chatReasonsTable.isActive, true))
    .orderBy(chatReasonsTable.id);
  return rows
    .map((r) => ({ id: r.id, matchers: (r.keywords ?? []).map(compileKeyword).filter((m): m is NonNullable<typeof m> => !!m) }))
    .filter((r) => r.matchers.length > 0);
}

/** Best topic for a text, or null. Ties go to the topic listed first. */
export function bestTopic(text: string, rules: TopicRule[]): number | null {
  const t = normalizeText(text);
  if (!t) return null;
  let best: number | null = null;
  let bestScore = 0;
  for (const r of rules) {
    let score = 0;
    for (const m of r.matchers) score += m(t);
    if (score > bestScore) { bestScore = score; best = r.id; }
  }
  return best;
}

/** (Re)file one conversation. Returns the topic id now on it (or null). */
export async function classifyConversation(conversationId: number, rules?: TopicRule[]): Promise<number | null> {
  const [conv] = await db
    .select({ id: conversationsTable.id, chatReasonId: conversationsTable.chatReasonId, auto: conversationsTable.chatReasonAuto })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conversationId));
  if (!conv) return null;
  if (conv.chatReasonId && !conv.auto) return conv.chatReasonId; // a person chose it

  const r = rules ?? (await loadTopicRules());
  const msgs = await db
    .select({ body: messagesTable.body })
    .from(messagesTable)
    .where(and(eq(messagesTable.conversationId, conversationId), eq(messagesTable.senderType, "customer"), eq(messagesTable.isNote, false)))
    .orderBy(desc(messagesTable.id))
    .limit(30);
  const topic = bestTopic(msgs.map((m) => m.body).join("\n"), r);

  if (topic !== conv.chatReasonId) {
    await db
      .update(conversationsTable)
      .set({ chatReasonId: topic, chatReasonAuto: topic !== null })
      .where(eq(conversationsTable.id, conversationId));
  }
  return topic;
}

/** Re-file every conversation that a person has not filed by hand. */
export async function reclassifyAll(): Promise<{ checked: number; filed: number }> {
  const rules = await loadTopicRules();
  const rows = await db
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(or(isNull(conversationsTable.chatReasonId), eq(conversationsTable.chatReasonAuto, true)));
  let filed = 0;
  for (const { id } of rows) {
    if ((await classifyConversation(id, rules)) !== null) filed++;
  }
  return { checked: rows.length, filed };
}

/* ----------------------------------------------------------- default topics */

const DEFAULT_TOPICS: { nameEn: string; nameAr: string; color: string; keywords: string[] }[] = [
  {
    nameEn: "Pricing & Quotes", nameAr: "الأسعار وعروض الأسعار", color: "#D4A03A",
    keywords: ["price", "prices", "pricing", "quote", "quotation", "cost", "how much", "budget", "invoice", "payment",
      "سعر", "اسعار", "عرض سعر", "تكلفه", "بكام", "كام سعر", "فاتوره", "الدفع", "ميزانيه"],
  },
  {
    nameEn: "Meetings & Demos", nameAr: "اجتماعات وعروض توضيحية", color: "#0E7490",
    keywords: ["meeting", "demo", "appointment", "schedule", "call me", "visit", "zoom", "google meet",
      "اجتماع", "ميعاد", "موعد", "مقابله", "ديمو", "عرض توضيحي", "زياره", "كلمني", "اتصل بي"],
  },
  {
    nameEn: "Technical Support", nameAr: "الدعم الفني", color: "#DC2626",
    keywords: ["problem", "issue", "error", "bug", "not working", "broken", "support", "crash", "down", "password",
      "مشكله", "عطل", "خطا", "غلط", "مش شغال", "مبيفتحش", "مش بيفتح", "الدعم", "مساعده"],
  },
  {
    nameEn: "ERP & Business Systems", nameAr: "أنظمة ERP والأعمال", color: "#0F2F55",
    keywords: ["erp", "odoo", "accounting", "inventory", "payroll", "crm", "pos", "warehouse", "hr system",
      "نظام erp", "محاسبه", "حسابات", "مخازن", "مخزون", "رواتب", "مرتبات", "نقاط بيع", "نظام مبيعات", "شئون عاملين"],
  },
  {
    nameEn: "Websites & Apps", nameAr: "المواقع والتطبيقات", color: "#22D3EE",
    keywords: ["website", "web site", "web app", "mobile app", "application", "ios", "android", "landing page", "online store", "e-commerce",
      "موقع", "ويب سايت", "تطبيق", "ابلكيشن", "ابليكيشن", "متجر الكتروني", "اندرويد", "ايفون"],
  },
  {
    nameEn: "AI & Automation", nameAr: "الذكاء الاصطناعي والأتمتة", color: "#7C3AED",
    keywords: ["ai", "artificial intelligence", "chatbot", "chat bot", "automation", "gpt", "machine learning",
      "ذكاء اصطناعي", "شات بوت", "بوت", "اتمته", "تعلم الي"],
  },
  {
    nameEn: "Cloud & Hosting", nameAr: "السحابة والاستضافة", color: "#0284C7",
    keywords: ["cloud", "hosting", "server", "domain", "backup", "vps", "aws", "azure",
      "سيرفر", "استضافه", "دومين", "سحابه", "سحابي", "نسخه احتياطيه"],
  },
  {
    nameEn: "Jobs & Careers", nameAr: "الوظائف والتدريب", color: "#6B7280",
    keywords: ["job", "jobs", "vacancy", "career", "cv", "resume", "internship", "hiring",
      "وظيفه", "وظايف", "تدريب", "سيره ذاتيه", "التقديم", "فرصه عمل"],
  },
  {
    nameEn: "Complaints", nameAr: "الشكاوى", color: "#B91C1C",
    keywords: ["complaint", "complain", "bad service", "late", "delay", "refund", "cancel", "disappointed",
      "شكوي", "شكوه", "متاخر", "تاخير", "استرجاع", "الغاء", "سيء", "وحش", "زعلان"],
  },
  {
    nameEn: "Partnerships", nameAr: "الشراكات والتعاون", color: "#059669",
    keywords: ["partner", "partnership", "collaboration", "reseller", "agency", "distributor",
      "شراكه", "تعاون", "وكيل", "توكيل", "موزع"],
  },
];

/** Insert the default topics once. Topics the admin later deletes stay deleted. */
export async function seedDefaultTopics(): Promise<void> {
  const [s] = await db.select({ seeded: settingsTable.topicsSeeded }).from(settingsTable).where(eq(settingsTable.id, 1));
  if (!s || s.seeded) return;
  const existing = await db.select({ nameEn: chatReasonsTable.nameEn }).from(chatReasonsTable);
  const have = new Set(existing.map((e) => e.nameEn.trim().toLowerCase()));
  const toAdd = DEFAULT_TOPICS.filter((t) => !have.has(t.nameEn.toLowerCase()));
  if (toAdd.length) await db.insert(chatReasonsTable).values(toAdd);
  await db.update(settingsTable).set({ topicsSeeded: true }).where(eq(settingsTable.id, 1));
  logger.info({ added: toAdd.length }, "topics: default topics seeded");
}

export async function bootTopics(): Promise<void> {
  try {
    await seedDefaultTopics();
    const r = await reclassifyAll();
    logger.info(r, "topics: conversations filed");
  } catch (err) {
    logger.error({ err }, "topics: boot failed");
  }
}

