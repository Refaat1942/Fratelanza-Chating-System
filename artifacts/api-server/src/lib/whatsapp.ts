/**
 * WhatsApp Business Cloud API (Meta) helpers.
 *
 * Environment:
 *   WHATSAPP_VERIFY_TOKEN     – string you type into Meta's "Verify token" box
 *   WHATSAPP_APP_SECRET       – Meta App Secret (App settings → Basic); used to
 *                               check the X-Hub-Signature-256 of every webhook
 *   WHATSAPP_ACCESS_TOKEN     – permanent System User token (outbound sends)
 *   WHATSAPP_PHONE_NUMBER_ID  – Phone number ID (not the phone number itself)
 *   WHATSAPP_API_VERSION      – Graph API version, default v22.0
 */
import crypto from "node:crypto";

export function whatsappConfig() {
  return {
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "",
    appSecret: process.env.WHATSAPP_APP_SECRET ?? "",
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    apiVersion: process.env.WHATSAPP_API_VERSION || "v22.0",
  };
}

export function whatsappSendingConfigured(): boolean {
  const c = whatsappConfig();
  return !!(c.accessToken && c.phoneNumberId);
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Validate Meta's `X-Hub-Signature-256: sha256=<hex>` against the raw body. */
export function verifyMetaSignature(
  rawBody: Buffer | undefined,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!rawBody || !header || !appSecret) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return safeEqual(expected, header);
}

/** Digits only — Meta sends `wa_id` without "+" (e.g. "201001234567"). */
export function digitsOnly(phone: string): string {
  return (phone ?? "").replace(/\D/g, "");
}

/* ------------------------------ payload parsing --------------------------- */

export interface InboundWhatsAppMessage {
  externalId: string;
  from: string; // digits
  name?: string;
  body: string;
  type: string;
  timestamp?: Date;
}

export interface WhatsAppStatusUpdate {
  externalId: string;
  status: "sent" | "delivered" | "read" | "failed";
  error?: string;
}

interface MetaMessage {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string; filename?: string };
  location?: { latitude?: number; longitude?: number; name?: string };
  reaction?: { emoji?: string };
}

function describeMessage(m: MetaMessage): string | null {
  switch (m.type) {
    case "text":
      return m.text?.body?.trim() || null;
    case "button":
      return m.button?.text?.trim() || "[button]";
    case "interactive":
      return (
        m.interactive?.button_reply?.title ||
        m.interactive?.list_reply?.title ||
        "[interactive reply]"
      );
    case "image":
      return m.image?.caption ? `[Image] ${m.image.caption}` : "[Image]";
    case "video":
      return m.video?.caption ? `[Video] ${m.video.caption}` : "[Video]";
    case "audio":
      return "[Voice/Audio message]";
    case "document":
      return `[Document] ${m.document?.filename ?? m.document?.caption ?? ""}`.trim();
    case "sticker":
      return "[Sticker]";
    case "location":
      return `[Location] ${m.location?.name ?? ""} ${m.location?.latitude ?? ""},${m.location?.longitude ?? ""}`.trim();
    case "contacts":
      return "[Contact card]";
    case "reaction":
      return null; // reactions are not chat messages
    default:
      return `[Unsupported message type: ${m.type ?? "unknown"}]`;
  }
}

/**
 * Walk a Meta webhook body (object = "whatsapp_business_account") and return
 * inbound messages and delivery-status updates. Tolerant of unknown shapes.
 */
export function parseWhatsAppWebhook(payload: unknown): {
  messages: InboundWhatsAppMessage[];
  statuses: WhatsAppStatusUpdate[];
} {
  const messages: InboundWhatsAppMessage[] = [];
  const statuses: WhatsAppStatusUpdate[] = [];
  const p = payload as {
    object?: string;
    entry?: {
      changes?: {
        field?: string;
        value?: {
          contacts?: { wa_id?: string; profile?: { name?: string } }[];
          messages?: MetaMessage[];
          statuses?: {
            id?: string;
            status?: string;
            errors?: { code?: number; title?: string; message?: string }[];
          }[];
        };
      }[];
    }[];
  };
  if (p?.object !== "whatsapp_business_account") return { messages, statuses };

  for (const entry of p.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field && change.field !== "messages") continue;
      const value = change.value;
      if (!value) continue;
      const names = new Map<string, string>();
      for (const c of value.contacts ?? []) {
        if (c.wa_id && c.profile?.name) names.set(c.wa_id, c.profile.name);
      }
      for (const m of value.messages ?? []) {
        if (!m.id || !m.from) continue;
        const body = describeMessage(m);
        if (!body) continue;
        messages.push({
          externalId: m.id,
          from: digitsOnly(m.from),
          name: names.get(m.from),
          body,
          type: m.type ?? "unknown",
          timestamp: m.timestamp
            ? new Date(Number(m.timestamp) * 1000)
            : undefined,
        });
      }
      for (const s of value.statuses ?? []) {
        if (!s.id) continue;
        if (
          s.status === "sent" ||
          s.status === "delivered" ||
          s.status === "read" ||
          s.status === "failed"
        ) {
          const err = s.errors?.[0];
          statuses.push({
            externalId: s.id,
            status: s.status,
            error: err ? `${err.code ?? ""} ${err.title ?? err.message ?? ""}`.trim() : undefined,
          });
        }
      }
    }
  }
  return { messages, statuses };
}

/* --------------------------------- sending -------------------------------- */

export class WhatsAppSendError extends Error {}

/** Send a free-form text message (only allowed inside the 24h service window). */
export async function sendWhatsAppText(
  toPhone: string,
  body: string,
): Promise<{ externalId: string }> {
  const c = whatsappConfig();
  if (!c.accessToken || !c.phoneNumberId) {
    throw new WhatsAppSendError("WhatsApp is not configured");
  }
  const to = digitsOnly(toPhone);
  if (!to) throw new WhatsAppSendError("Customer has no valid phone number");

  const res = await fetch(
    `https://graph.facebook.com/${c.apiVersion}/${c.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body },
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const data = (await res.json().catch(() => ({}))) as {
    messages?: { id?: string }[];
    error?: { message?: string; code?: number };
  };
  if (!res.ok || !data.messages?.[0]?.id) {
    throw new WhatsAppSendError(
      data.error
        ? `WhatsApp API error ${data.error.code ?? res.status}: ${data.error.message ?? "unknown"}`
        : `WhatsApp API returned HTTP ${res.status}`,
    );
  }
  return { externalId: data.messages[0].id };
}
