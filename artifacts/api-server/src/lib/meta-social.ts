/**
 * Facebook Messenger + Instagram Direct (Meta Messenger Platform).
 *
 * Both products use the same webhook shape (`entry[].messaging[]`), the same
 * X-Hub-Signature-256 signing (app secret) and the same Send API. Nothing here
 * runs unless the matching environment variables are set:
 *
 *   META_APP_SECRET                 app secret (falls back to WHATSAPP_APP_SECRET — same Meta app)
 *   META_VERIFY_TOKEN               webhook verify token (falls back to WHATSAPP_VERIFY_TOKEN)
 *   MESSENGER_PAGE_ACCESS_TOKEN     Page access token (pages_messaging)
 *   INSTAGRAM_ACCESS_TOKEN          Page token linked to the IG account, or an
 *                                   Instagram-Login user token ("IG…")
 *   INSTAGRAM_GRAPH_HOST            optional: graph.facebook.com | graph.instagram.com
 *   META_GRAPH_BASE_URL             optional, tests only: send Graph calls to a mock server
 */
import { whatsappConfig } from "./whatsapp";

export type SocialChannel = "messenger" | "instagram";

export function socialConfig() {
  const wa = whatsappConfig();
  const igToken = process.env.INSTAGRAM_ACCESS_TOKEN ?? "";
  return {
    appSecret: process.env.META_APP_SECRET || wa.appSecret,
    verifyToken: process.env.META_VERIFY_TOKEN || wa.verifyToken,
    apiVersion: process.env.META_API_VERSION || wa.apiVersion,
    messengerToken: process.env.MESSENGER_PAGE_ACCESS_TOKEN ?? "",
    instagramToken: igToken,
    instagramHost:
      process.env.INSTAGRAM_GRAPH_HOST || (igToken.startsWith("IG") ? "graph.instagram.com" : "graph.facebook.com"),
  };
}

export function socialSendingConfigured(channel: SocialChannel): boolean {
  const c = socialConfig();
  return channel === "messenger" ? !!c.messengerToken : !!c.instagramToken;
}

function tokenAndHost(channel: SocialChannel): { token: string; host: string; base: string; version: string } {
  const c = socialConfig();
  const host = channel === "messenger" ? "graph.facebook.com" : c.instagramHost;
  return {
    token: channel === "messenger" ? c.messengerToken : c.instagramToken,
    host,
    base: process.env.META_GRAPH_BASE_URL || `https://${host}`,
    version: c.apiVersion,
  };
}

// ── Webhook parsing ─────────────────────────────────────────────────────────

export interface SocialInbound {
  channel: SocialChannel;
  /** PSID (Messenger) or IGSID (Instagram) of the customer. */
  customerId: string;
  /** The Page / IG account that received it. */
  accountId: string;
  externalId: string;
  body: string;
  attachments: string[];
  direction: "in" | "out"; // "out" = echo of a message the business sent elsewhere
  timestamp: Date;
}

export interface SocialReceipt {
  channel: SocialChannel;
  customerId: string;
  kind: "delivered" | "read";
  /** Everything we sent at or before this time is covered. */
  watermark: Date;
  mids: string[];
}

interface MetaAttachment { type?: string; payload?: { url?: string; title?: string } | null }
interface MetaMessaging {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
    is_unsupported?: boolean;
    attachments?: MetaAttachment[];
    quick_reply?: { payload?: string };
    reply_to?: unknown;
  };
  postback?: { mid?: string; title?: string; payload?: string };
  delivery?: { mids?: string[]; watermark?: number };
  read?: { watermark?: number; mid?: string };
  reaction?: unknown;
}

const LABEL: Record<string, string> = {
  image: "[Image]",
  video: "[Video]",
  audio: "[Voice/Audio message]",
  file: "[File]",
  location: "[Location]",
  fallback: "[Link]",
  share: "[Shared post]",
  story_mention: "[Story mention]",
  ig_reel: "[Reel]",
  reel: "[Reel]",
  ig_post: "[Post]",
  template: "[Template]",
  sticker: "[Sticker]",
};

/** Walk a Messenger (`object: "page"`) or Instagram (`object: "instagram"`) webhook body. */
export function parseSocialWebhook(body: unknown): { channel: SocialChannel | null; messages: SocialInbound[]; receipts: SocialReceipt[] } {
  const b = body as { object?: string; entry?: { id?: string; time?: number; messaging?: MetaMessaging[] }[] } | null;
  const channel: SocialChannel | null = b?.object === "page" ? "messenger" : b?.object === "instagram" ? "instagram" : null;
  const messages: SocialInbound[] = [];
  const receipts: SocialReceipt[] = [];
  if (!channel) return { channel, messages, receipts };

  for (const entry of b?.entry ?? []) {
    const accountId = String(entry.id ?? "");
    for (const ev of entry.messaging ?? []) {
      const ts = new Date(typeof ev.timestamp === "number" ? ev.timestamp : Date.now());
      const sender = ev.sender?.id ?? "";
      const recipient = ev.recipient?.id ?? "";

      if (ev.message && ev.message.mid && !ev.message.is_deleted) {
        const m = ev.message;
        const echo = !!m.is_echo;
        const attachments = (m.attachments ?? [])
          .map((a) => a.payload?.url)
          .filter((u): u is string => typeof u === "string" && /^https:\/\//.test(u));
        const labels = (m.attachments ?? []).map((a) => LABEL[a.type ?? ""] ?? "[Attachment]");
        const text = (m.text ?? "").trim();
        const bodyText = text || labels.join(" ") || (m.is_unsupported ? "[A message type Meta doesn't share with connected apps — open the app to see it]" : "");
        if (!bodyText) continue;
        messages.push({
          channel,
          customerId: echo ? recipient : sender,
          accountId,
          externalId: m.mid!,
          body: bodyText,
          attachments,
          direction: echo ? "out" : "in",
          timestamp: ts,
        });
      } else if (ev.postback && sender) {
        // A tapped button: treat the button title as what the customer said.
        messages.push({
          channel,
          customerId: sender,
          accountId,
          externalId: ev.postback.mid ?? `postback:${sender}:${ts.getTime()}`,
          body: ev.postback.title || ev.postback.payload || "[Button]",
          attachments: [],
          direction: "in",
          timestamp: ts,
        });
      } else if (ev.delivery && sender) {
        receipts.push({ channel, customerId: sender, kind: "delivered", watermark: new Date(ev.delivery.watermark ?? ts.getTime()), mids: ev.delivery.mids ?? [] });
      } else if (ev.read && sender) {
        receipts.push({ channel, customerId: sender, kind: "read", watermark: new Date(ev.read.watermark ?? ts.getTime()), mids: ev.read.mid ? [ev.read.mid] : [] });
      }
    }
  }
  return { channel, messages, receipts };
}

// ── Send API ────────────────────────────────────────────────────────────────

export class SocialSendError extends Error {}

export async function sendSocialText(channel: SocialChannel, recipientId: string, text: string): Promise<{ externalId: string }> {
  const { token, base, version } = tokenAndHost(channel);
  if (!token) throw new SocialSendError(`${channel === "messenger" ? "Messenger" : "Instagram"} is not configured`);
  if (!recipientId) throw new SocialSendError("Customer has no Messenger/Instagram id");
  const res = await fetch(`${base}/${version}/me/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text: text.slice(0, 2000) } }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { message_id?: string; error?: { message?: string; code?: number; error_subcode?: number } };
  if (!res.ok || !data.message_id) {
    const e = data.error;
    // 10 / 2018278: outside the 24-hour standard messaging window.
    const hint = e && (e.code === 10 || e.error_subcode === 2018278) ? " (outside the 24-hour messaging window)" : "";
    throw new SocialSendError(e ? `Meta API error ${e.code ?? res.status}: ${e.message ?? "unknown"}${hint}` : `Meta API returned HTTP ${res.status}`);
  }
  return { externalId: data.message_id };
}

/** Best-effort display name for a new contact. Never throws. */
export async function fetchSocialProfileName(channel: SocialChannel, userId: string): Promise<string | null> {
  const { token, base, version } = tokenAndHost(channel);
  if (!token || !userId) return null;
  const fields = channel === "messenger" ? "first_name,last_name" : "name,username";
  try {
    const res = await fetch(`${base}/${version}/${encodeURIComponent(userId)}?fields=${fields}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { first_name?: string; last_name?: string; name?: string; username?: string };
    const n = channel === "messenger" ? [d.first_name, d.last_name].filter(Boolean).join(" ") : d.name || (d.username ? `@${d.username}` : "");
    return n.trim() || null;
  } catch {
    return null;
  }
}

/** Read-only connection check for Settings → Channels. */
export async function checkSocialConnection(channel: SocialChannel): Promise<{ ok: boolean; account?: string; id?: string; error?: string }> {
  const { token, host, base, version } = tokenAndHost(channel);
  if (!token) return { ok: false, error: "No access token configured" };
  const fields = host === "graph.instagram.com" ? "user_id,username" : "id,name";
  try {
    const res = await fetch(`${base}/${version}/me?fields=${fields}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
    const d = (await res.json().catch(() => ({}))) as { id?: string; user_id?: string; name?: string; username?: string; error?: { message?: string; code?: number } };
    if (!res.ok || d.error) return { ok: false, error: d.error ? `${d.error.code ?? res.status}: ${d.error.message}` : `HTTP ${res.status}` };
    return { ok: true, id: d.user_id ?? d.id, account: d.name ?? (d.username ? `@${d.username}` : undefined) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Request failed" };
  }
}
