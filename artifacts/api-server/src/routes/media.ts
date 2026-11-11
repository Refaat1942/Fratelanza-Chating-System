/**
 * GET /api/media/:key — customer media stored by lib/media.ts.
 *
 * The key is a random 144-bit capability (like Meta's own CDN links), so
 * <img>/<audio> tags can load it without an auth header. Hardening: only
 * image/audio/video/PDF are shown inline; anything else is a download, never
 * rendered as HTML; nosniff; private caching.
 */
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, mediaFilesTable } from "@workspace/db";

const router = Router();
const INLINE = /^(image\/(jpeg|png|webp|gif)|audio\/[\w.+-]+|video\/[\w.+-]+|application\/pdf)$/;

router.get("/media/:key", async (req, res) => {
  const key = String(req.params.key);
  if (!/^[\w-]{20,40}$/.test(key)) { res.sendStatus(404); return; }
  const [f] = await db.select().from(mediaFilesTable).where(eq(mediaFilesTable.key, key));
  if (!f) { res.sendStatus(404); return; }

  const inline = INLINE.test(f.mime);
  const type = inline ? f.mime : "application/octet-stream";
  const name = encodeURIComponent(f.filename ?? "file");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${name}`);
  res.setHeader("Accept-Ranges", "bytes");
  res.type(type);

  // Byte ranges (Safari needs them to play audio/video).
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.header("range") ?? "");
  const total = f.data.length;
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : total - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : total - 1;
    if (start < 0) start = 0;
    if (end >= total) end = total - 1;
    if (start > end) { res.status(416).setHeader("Content-Range", `bytes */${total}`); res.end(); return; }
    res.status(206).setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
    res.end(f.data.subarray(start, end + 1));
    return;
  }
  res.end(f.data);
});

export default router;
