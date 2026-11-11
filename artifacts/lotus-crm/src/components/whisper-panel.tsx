/**
 * Whisper Mode panel: private supervisor <-> agent messages about this chat.
 * Nothing here is ever sent to the customer — whispers live in their own
 * table and API on the server; this panel is just a view of that thread.
 */
import React, { useEffect, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, EyeOff, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { getSharedSocket } from "@/hooks/use-socket";
import { useMarkWhispersRead, useSendWhisper, useWhispers, whispersKey, type Whisper } from "@/lib/api-extra";
import { cn } from "@/lib/utils";

export function WhisperPanel({
  conversationId,
  meId,
  isLead,
  agentName,
}: {
  conversationId: number;
  meId?: number;
  /** Supervisor/admin allowed to whisper (vs. the agent on the chat). */
  isLead: boolean;
  /** The agent a supervisor is whispering to. */
  agentName?: string | null;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: whispers = [], isLoading } = useWhispers(conversationId);
  const send = useSendWhisper(conversationId);
  const markRead = useMarkWhispersRead();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(isLead);
  const listRef = useRef<HTMLDivElement>(null);

  // Live: the server only delivers whispers to the agent's own room and the
  // supervisors' room, so any event we get here is ours to show.
  useEffect(() => {
    const socket = getSharedSocket();
    const onWhisper = (w: Whisper) => {
      if (w.conversationId !== conversationId) return;
      qc.setQueryData<Whisper[]>(whispersKey(conversationId), (prev) =>
        prev && !prev.some((x) => x.id === w.id) ? [...prev, w] : prev ?? [w],
      );
      if (w.senderId !== meId) setOpen(true);
    };
    socket.on("whisper", onWhisper);
    return () => { socket.off("whisper", onWhisper); };
  }, [conversationId, meId, qc]);

  const unread = whispers.filter((w) => w.senderId !== meId && !w.readAt).length;
  useEffect(() => {
    if (open && unread > 0 && document.visibilityState === "visible") markRead.mutate(conversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, unread, conversationId]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [whispers.length, open]);

  // Agents only see the panel once a supervisor is involved or they open it.
  if (!isLead && !isLoading && whispers.length === 0 && !open) {
    return (
      <div className="max-w-3xl mx-auto w-full px-2 sm:px-4 pt-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[11px] text-whisper hover:underline inline-flex items-center gap-1"
          data-testid="btn-ask-supervisor"
        >
          <EyeOff className="h-3 w-3" aria-hidden /> Ask a supervisor privately
        </button>
      </div>
    );
  }

  const submit = () => {
    const body = text.trim();
    if (!body || send.isPending) return;
    send.mutate(body, {
      onSuccess: () => setText(""),
      onError: (e) =>
        toast({
          title: "Whisper not sent",
          description: (e as { data?: { error?: string } }).data?.error ?? "Try again.",
          variant: "destructive",
        }),
    });
  };

  return (
    <section
      className="max-w-3xl mx-auto w-full px-2 sm:px-4 pt-2"
      aria-label="Whisper — private supervisor messages"
      data-testid="whisper-panel"
    >
      <div className="rounded-xl border border-whisper/40 bg-whisper/5 overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-whisper"
          aria-expanded={open}
        >
          <EyeOff className="h-3.5 w-3.5" aria-hidden />
          <span>Whisper</span>
          <span className="font-normal text-muted-foreground truncate">
            {isLead
              ? `private to ${agentName ?? "the agent"} — the customer never sees this`
              : "private with your supervisor — the customer never sees this"}
          </span>
          {unread > 0 && (
            <span className="ml-auto rounded-full bg-whisper text-whisper-foreground px-1.5 text-[10px] leading-4">{unread}</span>
          )}
          {open ? <ChevronDown className={cn("h-3.5 w-3.5", unread === 0 && "ml-auto")} /> : <ChevronUp className={cn("h-3.5 w-3.5", unread === 0 && "ml-auto")} />}
        </button>
        {open && (
          <>
            <div ref={listRef} className="max-h-44 overflow-y-auto px-3 pb-2 space-y-1.5" role="log" aria-live="polite">
              {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
              {!isLoading && whispers.length === 0 && (
                <p className="text-xs text-muted-foreground py-1">
                  {isLead ? "Write an instruction for the agent. Only they and other supervisors will see it." : "Write to your supervisor. Only supervisors will see it."}
                </p>
              )}
              {whispers.map((w) => {
                const mine = w.senderId === meId;
                return (
                  <div key={w.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm border",
                        mine ? "bg-whisper/15 border-whisper/30" : "bg-card border-whisper/30",
                      )}
                    >
                      <p className="text-[10px] font-semibold text-whisper">
                        {mine ? "You" : w.senderName ?? "Supervisor"}
                        {w.senderRole && w.senderRole !== "agent" && !mine ? " · supervisor" : ""}
                      </p>
                      <p className="whitespace-pre-wrap break-words bidi">{w.body}</p>
                      <time className="block text-right text-[10px] text-muted-foreground">{format(parseISO(w.createdAt), "h:mm a")}</time>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-end gap-2 border-t border-whisper/30 p-2">
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
                }}
                rows={1}
                maxLength={2000}
                placeholder={isLead ? "Private instruction to the agent…" : "Private message to your supervisor…"}
                aria-label="Whisper message"
                className="min-h-[40px] max-h-28 resize-none text-sm bg-background"
                data-testid="input-whisper"
              />
              <Button
                type="button"
                size="sm"
                className="h-10 bg-whisper text-whisper-foreground hover:bg-whisper/90"
                onClick={submit}
                disabled={!text.trim() || send.isPending}
                data-testid="btn-send-whisper"
              >
                {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                <span className="sr-only">Send whisper</span>
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
