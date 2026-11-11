/**
 * Customer media: download from WhatsApp (Graph media id) or from Meta's CDN
 * (Messenger / Instagram attachment URLs, which expire), store in
 * `media_files`, and attach the local URL to the message.
 *
 * Runs after the webhook has been answered, so a slow download never makes
 * Meta retry. A failed download leaves the text label (e.g. "[Image]").
 */
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import type { Server as IOServer } from "socket.io";
import { db, mediaFilesTable, messagesTable } from "@workspace/db";
import { whatsappConfig } from "./whatsapp";
import { logger } from "./logger";

export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

export type MediaKind = "image" | "audio" | "video" | "file";

export function kindOf(mime: string): MediaKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "file";
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/amr": "amr",
  "video/mp4": "mp4", "video/3gpp": "3gp", "application/pdf": "pdf",
};

export async function storeMedia(data: Buffer, mime: string, filename: string | null, source: string): Promise<string> {
  const key = crypto.randomBytes(18).toString("base64url");
  const clean = mime.split(";")[0]!.trim().toLowerCase() || "application/octet-stream";
  const name = (filename || `${kindOf(clean)}.${EXT[clean] ?? "bin"}`).replace(/[^\w.\- ()؀-ۿ]/g, "_").slice(0, 120);
  await db.insert(mediaFilesTable).values({ key, mime: clean, filename: name, size: data.length, data, source });
  return `/api/media/${key}?t=${kindOf(clean)}&n=${encodeURIComponent(name)}`;
}

async function readCapped(res: Response): Promise<Buffer> {
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_MEDIA_BYTES) throw new Error(`Media too large (${len} bytes)`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_MEDIA_BYTES) throw new Error(`Media too large (${buf.length} bytes)`);
  return buf;
}

/** WhatsApp: media id → temporary URL → bytes (both calls need the token). */
export async function downloadWhatsAppMedia(mediaId: string): Promise<{ data: Buffer; mime: string }> {
  const c = whatsappConfig();
  if (!c.accessToken) throw new Error("WHATSAPP_ACCESS_TOKEN not set");
  const base = process.env.META_GRAPH_BASE_URL || "https://graph.facebook.com";
  const meta = await fetch(`${base}/${c.apiVersion}/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${c.accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const info = (await meta.json().catch(() => ({}))) as { url?: string; mime_type?: string; file_size?: number };
  if (!meta.ok || !info.url) throw new Error(`Media lookup failed (HTTP ${meta.status})`);
  if ((info.file_size ?? 0) > MAX_MEDIA_BYTES) throw new Error("Media too large");
  const res = await fetch(info.url, { headers: { Authorization: `Bearer ${c.accessToken}` }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Media download failed (HTTP ${res.status})`);
  return { data: await readCapped(res), mime: info.mime_type || res.headers.get("content-type") || "application/octet-stream" };
}

/** Messenger / Instagram CDN URL → bytes (public, short-lived URLs). */
export async function downloadUrl(url: string): Promise<{ data: Buffer; mime: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000), redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  return { data: await readCapped(res), mime: res.headers.get("content-type") || "application/octet-stream" };
}

/** Store the media and add it to the message's attachments (replacing `replaceUrl` if given). */
export async function attachMedia(
  messageId: number,
  fetcher: () => Promise<{ data: Buffer; mime: string }>,
  opts: { filename?: string | null; source: string; replaceUrl?: string; io?: IOServer; conversationId?: number },
): Promise<void> {
  try {
    const { data, mime } = await fetcher();
    const url = await storeMedia(data, mime, opts.filename ?? null, opts.source);
    const [row] = await db.select({ attachments: messagesTable.attachments }).from(messagesTable).where(eq(messagesTable.id, messageId));
    if (!row) return;
    const list = opts.replaceUrl ? row.attachments.map((a) => (a === opts.replaceUrl ? url : a)) : [...row.attachments, url];
    if (!list.includes(url)) list.push(url);
    const [updated] = await db.update(messagesTable).set({ attachments: list }).where(eq(messagesTable.id, messageId)).returning();
    // Same event as a new message: the client merges by id, so the bubble updates in place.
    if (updated && opts.io && opts.conversationId) opts.io.to(`conv:${opts.conversationId}`).emit("new_message", updated);
  } catch (err) {
    logger.warn({ err, messageId, source: opts.source }, "Media download failed — keeping the text label");
  }
}
