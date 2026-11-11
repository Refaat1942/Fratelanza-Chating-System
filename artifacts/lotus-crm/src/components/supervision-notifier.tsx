/**
 * App-wide real-time notices for Whisper Mode and takeovers, so an agent sees
 * a supervisor's instruction even while another chat (or page) is open.
 */
import React, { useEffect } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { getSharedSocket } from "@/hooks/use-socket";
import type { Whisper } from "@/lib/api-extra";

export function SupervisionNotifier({ meId }: { meId?: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (!meId) return;
    const socket = getSharedSocket();
    const open = (id: number) => setLocation(`/chat?conv=${id}`);
    const viewing = (id: number) => location.startsWith("/chat") && window.location.search.includes(`conv=${id}`);

    const onWhisper = (w: Whisper) => {
      void qc.invalidateQueries({ queryKey: ["/api/whispers/unread"] });
      if (w.senderId === meId || viewing(w.conversationId)) return;
      toast({
        title: `Whisper from ${w.senderName ?? "a supervisor"}`,
        description: w.body.length > 140 ? `${w.body.slice(0, 140)}…` : w.body,
        action: <ToastAction altText="Open chat" onClick={() => open(w.conversationId)}>Open</ToastAction>,
      });
    };
    const onTakeover = (e: { conversationId: number; byName?: string }) => {
      void qc.invalidateQueries({ queryKey: ["/api/conversations"] });
      toast({ title: `${e.byName ?? "A supervisor"} took over one of your chats`, description: "You can still follow their whispers. It will come back to you when they hand it back." });
    };
    const onReleased = (e: { conversationId: number; byName?: string }) => {
      void qc.invalidateQueries({ queryKey: ["/api/conversations"] });
      toast({
        title: "A chat was handed back to you",
        description: e.byName ? `${e.byName} returned it.` : undefined,
        action: <ToastAction altText="Open chat" onClick={() => open(e.conversationId)}>Open</ToastAction>,
      });
    };
    socket.on("whisper", onWhisper);
    socket.on("takeover", onTakeover);
    socket.on("takeover_released", onReleased);
    return () => {
      socket.off("whisper", onWhisper);
      socket.off("takeover", onTakeover);
      socket.off("takeover_released", onReleased);
    };
  }, [meId, location, qc, setLocation, toast]);

  return null;
}
