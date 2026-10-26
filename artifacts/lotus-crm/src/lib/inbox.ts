/**
 * Live inbox plumbing.
 *
 * Strategy (cheap + reliable):
 *  1. GET /api/inbox/sync returns a tiny aggregate {total, unread, version}.
 *     It is polled every ~5s (only while the tab is visible).
 *  2. Only when `version` changes do we refetch the conversation list.
 *  3. The open thread is fetched incrementally (?afterId=) — never in full.
 *  4. Socket.io events (new_message / conversation_updated / message_status)
 *     trigger an immediate sync, so delivery is near-instant when the socket
 *     works, and polling covers proxies/networks where it does not.
 */
import { useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, getListConversationsQueryKey, getListMessagesQueryKey } from "@workspace/api-client-react";
import type { Message } from "@workspace/api-client-react";
import { getSharedSocket } from "@/hooks/use-socket";
import { useAuth } from "@/lib/auth";

export interface InboxSync {
  total: number;
  unread: number;
  version: string;
}

export function pollIntervalMs(): number {
  try {
    const v = Number(localStorage.getItem("inbox_poll_ms"));
    if (Number.isFinite(v) && v >= 2000 && v <= 60000) return v;
  } catch { /* storage unavailable */ }
  return 5000;
}

const SYNC_KEY = ["/api/inbox/sync"] as const;

/** Mount once (AppLayout). Keeps lists/unread badges live app-wide. */
export function useInboxSync(enabled: boolean) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const lastVersion = useRef<string | null>(null);

  const query = useQuery({
    queryKey: SYNC_KEY,
    queryFn: () => customFetch<InboxSync>("/api/inbox/sync"),
    enabled,
    refetchInterval: () => (document.visibilityState === "visible" ? pollIntervalMs() : false),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
    retry: 1,
  });

  // Version moved → refresh list (and any open thread via its own query key).
  useEffect(() => {
    const v = query.data?.version;
    if (v === undefined) return;
    if (lastVersion.current !== null && lastVersion.current !== v) {
      void qc.invalidateQueries({ queryKey: getListConversationsQueryKey() });
      void qc.invalidateQueries({ queryKey: ["thread"] });
      void qc.invalidateQueries({ queryKey: ["/api/insights"] });
    }
    lastVersion.current = v;
  }, [query.data?.version, qc]);

  const refetch = query.refetch;
  useEffect(() => {
    if (!enabled || !user) return;
    const socket = getSharedSocket();
    let t: ReturnType<typeof setTimeout> | null = null;
    const kick = () => {
      if (t) return; // coalesce bursts
      t = setTimeout(() => { t = null; void refetch(); }, 150);
    };
    const onStatus = ({ messageId, status }: { messageId: number; status: string }) => {
      qc.setQueriesData<Message[]>({ queryKey: ["thread"] }, (old) =>
        Array.isArray(old)
          ? old.map((m) => (m.id === messageId ? ({ ...m, status } as Message) : m))
          : old,
      );
    };
    socket.on("new_message", kick);
    socket.on("conversation_updated", kick);
    socket.on("conversation_assigned", kick);
    socket.on("conversation_queued", kick);
    socket.on("message_status", onStatus);
    socket.on("connect", kick);
    return () => {
      if (t) clearTimeout(t);
      socket.off("new_message", kick);
      socket.off("conversation_updated", kick);
      socket.off("conversation_assigned", kick);
      socket.off("conversation_queued", kick);
      socket.off("message_status", onStatus);
      socket.off("connect", kick);
    };
  }, [enabled, user, refetch, qc]);

  // Unread count in the browser tab title.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s*/, "");
    const n = query.data?.unread ?? 0;
    document.title = n > 0 ? `(${n > 99 ? "99+" : n}) ${base}` : base;
  }, [query.data?.unread]);

  return query.data;
}

export function useInboxUnread(): number {
  const { data } = useQuery({ queryKey: SYNC_KEY, enabled: false });
  return (data as InboxSync | undefined)?.unread ?? 0;
}

function mergeById(prev: Message[], next: Message[]): Message[] {
  if (next.length === 0) return prev;
  const seen = new Map<number, Message>();
  for (const m of prev) seen.set(m.id, m);
  for (const m of next) seen.set(m.id, m);
  return [...seen.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id - b.id,
  );
}

/**
 * Messages for one conversation. First load = full thread; every refetch after
 * that only asks for messages newer than the last one we have, and merges by
 * id so nothing is ever duplicated.
 */
export function useThread(conversationId: number | null) {
  const qc = useQueryClient();
  const key = ["thread", conversationId] as const;
  const fullLoaded = useRef<number | null>(null);

  const query = useQuery({
    queryKey: key,
    enabled: conversationId !== null,
    staleTime: 0,
    queryFn: async () => {
      const base = `/api/conversations/${conversationId}/messages`;
      const prev = qc.getQueryData<Message[]>(key);
      if (prev && prev.length > 0 && fullLoaded.current === conversationId) {
        const lastId = Math.max(...prev.map((m) => m.id));
        const fresh = await customFetch<Message[]>(`${base}?afterId=${lastId}`);
        return mergeById(prev, fresh);
      }
      const all = await customFetch<Message[]>(base);
      fullLoaded.current = conversationId;
      return all;
    },
  });

  const append = useCallback(
    (msg: Message) => {
      qc.setQueryData<Message[]>(key, (old) => mergeById(old ?? [], [msg]));
      // keep the legacy generated key coherent for anything still reading it
      qc.setQueryData<Message[]>(getListMessagesQueryKey(conversationId ?? 0), (old) =>
        old ? mergeById(old, [msg]) : old,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, conversationId],
  );

  return { ...query, append };
}

export async function markConversationRead(id: number): Promise<void> {
  await customFetch(`/api/conversations/${id}/read`, { method: "POST" });
}
