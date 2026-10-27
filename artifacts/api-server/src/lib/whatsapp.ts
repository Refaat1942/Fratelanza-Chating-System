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
  // type "unsupported": content the Cloud API does not pass on (polls,
  // view-once media, edits, …). Meta may say which kind in `unsupported.type`.
  unsupported?: { type?: string };
  errors?: { code?: number; title?: string; error_data?: { details?: string } }[];
}

/** Friendly names for kinds Meta reports as unsupported. */
const UNSUPPORTED_KINDS: Record<string, string> = {
  poll_creation: "poll",
  poll: "poll",
  poll_update: "poll vote",
  view_once: "view-once photo/video",
  edit: "edited message",
  event: "event",
  event_creation: "event",
  ephemeral: "disappearing message",
  album: "album",
};

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
    case "unsupported": {
      const kind = m.unsupported?.type;
      const what = kind ? (UNSUPPORTED_KINDS[kind] ?? kind.replace(/_/g, " ")) : "";
      return `[${what ? `${what[0].toUpperCase()}${what.slice(1)} — ` : ""}WhatsApp doesn't pass this message type to connected apps. Open WhatsApp on the phone to see it]`;
    }
    case "system":
      return "[WhatsApp system notice]";
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

/* ------------------------------------------------------------------------ *
 * WhatsApp Business app "Coexistence" sync                                  *
 *                                                                           *
 * When the number is used in the WhatsApp Business app AND the Cloud API,   *
 * Meta can send three extra webhook fields (they must be ticked in the app's *
 * WhatsApp → Configuration → Webhook fields):                               *
 *   smb_message_echoes  – messages you send from the phone app              *
 *   history             – past chats, shared once during onboarding         *
 *   smb_app_state_sync  – contacts added/edited in the phone app            *
 * Labels / lists made in the phone app are NOT exposed by any Meta API.     *
 * ------------------------------------------------------------------------ */

export interface SyncedMessage {
  externalId: string;
  customer: string; // customer digits
  direction: "in" | "out";
  body: string;
  timestamp?: Date;
  status?: "sent" | "delivered" | "read";
}

export interface SyncedContact {
  phone: string; // digits
  name?: string;
  action: string; // "add" | "edit" | "remove" | …
}

type SyncMessage = MetaMessage & { to?: string; history_context?: { status?: string } };

function toDate(ts?: string): Date | undefined {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : undefined;
}

function historyStatus(s?: string): SyncedMessage["status"] {
  const v = (s ?? "").toLowerCase();
  if (v === "read" || v === "played") return "read";
  if (v === "delivered") return "delivered";
  if (v) return "sent";
  return undefined;
}

export function parseBusinessAppSync(payload: unknown): {
  echoes: SyncedMessage[];
  history: SyncedMessage[];
  contacts: SyncedContact[];
} {
  const echoes: SyncedMessage[] = [];
  const history: SyncedMessage[] = [];
  const contacts: SyncedContact[] = [];
  const p = payload as {
    object?: string;
    entry?: { changes?: { field?: string; value?: Record<string, unknown> }[] }[];
  };
  if (p?.object !== "whatsapp_business_account") return { echoes, history, contacts };

  for (const entry of p.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = (change.value ?? {}) as {
        metadata?: { display_phone_number?: string };
        message_echoes?: SyncMessage[];
        history?: { threads?: { id?: string; messages?: SyncMessage[] }[] }[];
        state_sync?: {
          type?: string;
          action?: string;
          contact?: { full_name?: string; first_name?: string; phone_number?: string; wa_id?: string };
        }[];
      };
      const business = digitsOnly(v.metadata?.display_phone_number ?? "");

      if (change.field === "smb_message_echoes") {
        for (const m of v.message_echoes ?? []) {
          const to = digitsOnly(m.to ?? "");
          const body = describeMessage(m);
          if (!m.id || !to || !body) continue;
          echoes.push({ externalId: m.id, customer: to, direction: "out", body, timestamp: toDate(m.timestamp), status: "sent" });
        }
      } else if (change.field === "history") {
        for (const chunk of v.history ?? []) {
          for (const thread of chunk.threads ?? []) {
            const customer = digitsOnly(thread.id ?? "");
            if (!customer) continue;
            for (const m of thread.messages ?? []) {
              const body = describeMessage(m);
              if (!m.id || !body) continue;
              const from = digitsOnly(m.from ?? "");
              const out = (business && from === business) || (!!m.to && from !== customer);
              history.push({
                externalId: m.id,
                customer,
                direction: out ? "out" : "in",
                body,
                timestamp: toDate(m.timestamp),
                status: out ? historyStatus(m.history_context?.status) : undefined,
              });
            }
          }
        }
      } else if (change.field === "smb_app_state_sync") {
        for (const s of v.state_sync ?? []) {
          if (s.type && s.type !== "contact") continue;
          const phone = digitsOnly(s.contact?.phone_number ?? s.contact?.wa_id ?? "");
          if (!phone) continue;
          const name = (s.contact?.full_name ?? s.contact?.first_name ?? "").trim() || undefined;
          contacts.push({ phone, name, action: (s.action ?? "add").toLowerCase() });
        }
      }
    }
  }
  return { echoes, history, contacts };
}
