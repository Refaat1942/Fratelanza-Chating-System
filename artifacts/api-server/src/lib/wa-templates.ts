/**
 * WhatsApp message templates: read-only sync from the WhatsApp Business
 * Account, rendering, and sending an approved template to a customer (the only
 * way to write first / after the 24-hour window).
 */
import { sql } from "drizzle-orm";
import { db, whatsappTemplatesTable } from "@workspace/db";
import { whatsappConfig, digitsOnly, WhatsAppSendError } from "./whatsapp";

interface MetaComponent {
  type?: string; // HEADER | BODY | FOOTER | BUTTONS
  format?: string; // TEXT | IMAGE | VIDEO | DOCUMENT | LOCATION
  text?: string;
  buttons?: { type?: string; text?: string; url?: string }[];
}

function graphBase(): string {
  return process.env.META_GRAPH_BASE_URL || "https://graph.facebook.com";
}

export function templatesConfigured(): boolean {
  const c = whatsappConfig();
  return !!(c.accessToken && process.env.WHATSAPP_BUSINESS_ACCOUNT_ID);
}

/** Pull every template from Meta and upsert by (name, language). */
export async function syncTemplates(): Promise<{ synced: number }> {
  const c = whatsappConfig();
  const waba = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  if (!c.accessToken || !waba) throw new Error("Set WHATSAPP_BUSINESS_ACCOUNT_ID (and WHATSAPP_ACCESS_TOKEN) to sync templates");
  let url: string | null =
    `${graphBase()}/${c.apiVersion}/${encodeURIComponent(waba)}/message_templates?fields=id,name,language,status,category,components,rejected_reason&limit=100`;
  let synced = 0;
  for (let page = 0; url && page < 20; page++) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${c.accessToken}` }, signal: AbortSignal.timeout(20_000) });
    const d = (await res.json().catch(() => ({}))) as {
      data?: { id?: string; name?: string; language?: string; status?: string; category?: string; components?: MetaComponent[]; rejected_reason?: string }[];
      paging?: { next?: string };
      error?: { message?: string; code?: number };
    };
    if (!res.ok || d.error) throw new Error(d.error ? `Meta API error ${d.error.code ?? res.status}: ${d.error.message}` : `HTTP ${res.status}`);
    for (const t of d.data ?? []) {
      if (!t.name || !t.language) continue;
      await db
        .insert(whatsappTemplatesTable)
        .values({
          metaId: t.id ?? null, name: t.name, language: t.language, category: t.category ?? null,
          status: t.status ?? "UNKNOWN", components: t.components ?? [], rejectedReason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
          syncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [whatsappTemplatesTable.name, whatsappTemplatesTable.language],
          set: {
            metaId: t.id ?? null, category: t.category ?? null, status: t.status ?? "UNKNOWN", components: t.components ?? [],
            rejectedReason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null, syncedAt: new Date(),
          },
        });
      synced++;
    }
    url = d.paging?.next ?? null;
  }
  return { synced };
}

/** Status webhook (`message_template_status_update`). */
export async function applyTemplateStatus(v: { event?: string; message_template_id?: number | string; message_template_name?: string; message_template_language?: string; reason?: string }): Promise<void> {
  if (!v.event) return;
  const reason = v.reason && v.reason !== "NONE" ? v.reason : null;
  if (v.message_template_id) {
    await db.execute(sql`UPDATE whatsapp_templates SET status = ${v.event}, rejected_reason = ${reason} WHERE meta_id = ${String(v.message_template_id)}`);
  } else if (v.message_template_name && v.message_template_language) {
    await db.execute(sql`UPDATE whatsapp_templates SET status = ${v.event}, rejected_reason = ${reason} WHERE name = ${v.message_template_name} AND language = ${v.message_template_language}`);
  }
}

/** Placeholders in a component's text, in order: ["1","2"] or ["first_name"]. */
export function placeholders(text?: string): string[] {
  const out: string[] = [];
  for (const m of (text ?? "").matchAll(/\{\{\s*([\w]+)\s*\}\}/g)) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out;
}

function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([\w]+)\s*\}\}/g, (m, k: string) => values[k] ?? m);
}

export interface TemplateParams { header?: Record<string, string>; body?: Record<string, string> }

/** What the customer will read (stored as the message text in the inbox). */
export function renderTemplate(components: MetaComponent[], p: TemplateParams): string {
  const header = components.find((c) => c.type === "HEADER");
  const body = components.find((c) => c.type === "BODY");
  const footer = components.find((c) => c.type === "FOOTER");
  const buttons = components.find((c) => c.type === "BUTTONS");
  return [
    header?.format === "TEXT" && header.text ? `*${fill(header.text, p.header ?? {})}*` : header?.format ? `[${header.format.toLowerCase()}]` : null,
    body?.text ? fill(body.text, p.body ?? {}) : null,
    footer?.text ? `_${footer.text}_` : null,
    buttons?.buttons?.length ? buttons.buttons.map((b) => `[${b.text}]`).join(" ") : null,
  ].filter(Boolean).join("\n");
}

/** Missing placeholder values, or a reason the template can't be sent from here. */
export function validateParams(components: MetaComponent[], p: TemplateParams): string | null {
  const header = components.find((c) => c.type === "HEADER");
  if (header?.format && header.format !== "TEXT") return `Templates with a ${header.format.toLowerCase()} header can't be sent from the inbox yet`;
  const buttons = components.find((c) => c.type === "BUTTONS");
  if (buttons?.buttons?.some((b) => b.type === "URL" && /\{\{/.test(b.url ?? ""))) return "Templates with a dynamic link button can't be sent from the inbox yet";
  for (const [part, comp] of [["header", header], ["body", components.find((c) => c.type === "BODY")]] as const) {
    for (const k of placeholders(comp?.text)) {
      const v = (p[part] ?? {})[k];
      if (!v || !v.trim()) return `Fill in every placeholder ({{${k}}} in the ${part})`;
    }
  }
  return null;
}

export async function sendTemplate(toPhone: string, name: string, language: string, components: MetaComponent[], p: TemplateParams): Promise<{ externalId: string }> {
  const c = whatsappConfig();
  if (!c.accessToken || !c.phoneNumberId) throw new WhatsAppSendError("WhatsApp is not configured");
  const to = digitsOnly(toPhone);
  if (!to) throw new WhatsAppSendError("Customer has no valid phone number");
  const params = (part: "header" | "body", text?: string) =>
    placeholders(text).map((k) => (/^\d+$/.test(k)
      ? { type: "text", text: (p[part] ?? {})[k] }
      : { type: "text", parameter_name: k, text: (p[part] ?? {})[k] }));
  const header = components.find((x) => x.type === "HEADER");
  const body = components.find((x) => x.type === "BODY");
  const comps = [
    ...(header?.format === "TEXT" && placeholders(header.text).length ? [{ type: "header", parameters: params("header", header.text) }] : []),
    ...(placeholders(body?.text).length ? [{ type: "body", parameters: params("body", body?.text) }] : []),
  ];
  const res = await fetch(`${graphBase()}/${c.apiVersion}/${c.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", recipient_type: "individual", to, type: "template",
      template: { name, language: { code: language }, ...(comps.length ? { components: comps } : {}) },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { message?: string; code?: number } };
  if (!res.ok || !data.messages?.[0]?.id) {
    throw new WhatsAppSendError(data.error ? `WhatsApp API error ${data.error.code ?? res.status}: ${data.error.message ?? "unknown"}` : `WhatsApp API returned HTTP ${res.status}`);
  }
  return { externalId: data.messages[0].id };
}
