/** One message attachment: inline photo, voice note / audio player, video, or a file link. */
import React from "react";
import { FileText } from "lucide-react";

function info(url: string): { kind: "image" | "audio" | "video" | "file"; name: string } {
  if (url.startsWith("data:image")) return { kind: "image", name: "image" };
  try {
    const u = new URL(url, window.location.origin);
    if (u.pathname.startsWith("/api/media/")) {
      const t = u.searchParams.get("t");
      return { kind: t === "image" || t === "audio" || t === "video" ? t : "file", name: u.searchParams.get("n") ?? "file" };
    }
    const name = decodeURIComponent(u.pathname.split("/").pop() ?? "file");
    if (/\.(png|jpe?g|gif|webp)$/i.test(u.pathname)) return { kind: "image", name };
    if (/\.(ogg|mp3|m4a|aac|amr|opus)$/i.test(u.pathname)) return { kind: "audio", name };
    if (/\.(mp4|3gp|mov)$/i.test(u.pathname)) return { kind: "video", name };
    return { kind: "file", name };
  } catch {
    return { kind: "file", name: "file" };
  }
}

export function AttachmentView({ url, index }: { url: string; index: number }) {
  const { kind, name } = info(url);
  if (kind === "image") {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open image ${index + 1}`}>
        <img src={url} alt={name === "image" ? "Attachment" : name} className="rounded-lg max-h-64 object-contain bg-black/5" loading="lazy" />
      </a>
    );
  }
  if (kind === "audio") return <audio controls preload="none" src={url} className="max-w-[260px] h-10" aria-label="Voice message" />;
  if (kind === "video") return <video controls preload="metadata" src={url} className="rounded-lg max-h-64 max-w-full" />;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs underline break-all">
      <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden /> {name || `Attachment ${index + 1}`}
    </a>
  );
}
