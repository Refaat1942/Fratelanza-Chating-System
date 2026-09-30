import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  useListConversations,
  useGetConversation,
  useSendMessage,
  useResolveConversation,
  usePatchConversation,
  useAssignConversation,
  useListUsers,
  useListTags,
  useListQuickReplies,
  getListConversationsQueryKey,
  getGetConversationQueryKey,
} from "@workspace/api-client-react";
import type { Message, Conversation } from "@workspace/api-client-react";
import { useConversationSocket, useTypingEmit, useTypingIndicator } from "@/hooks/use-socket";
import { format, parseISO, isToday, isYesterday, differenceInHours } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import {
  Search,
  CheckCircle2,
  Clock,
  Paperclip,
  Send,
  Phone,
  MapPin,
  Tag as TagIcon,
  MessageSquare,
  X,
  Plus,
  ChevronDown,
  ChevronLeft,
  PanelRight,
  Check,
  CheckCheck,
  AlertCircle,
  ArrowDown,
  RotateCcw,
  Loader2,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { FaWhatsapp, FaFacebookMessenger, FaInstagram, FaSms } from "react-icons/fa";
import { useLocation, useSearch } from "wouter";
import { useInsights, useChatReasons, useUploadAttachment, useMyPermissions } from "@/lib/api-extra";
import { useThread, markConversationRead } from "@/lib/inbox";
import { useMediaQuery } from "@/hooks/use-media-query";
import { EmptyState, ErrorState } from "@/components/states";
import { initials, userLabel, type AppUser } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useGetMe } from "@workspace/api-client-react";

type Conv = Conversation & {
  channel?: string;
  lastSenderType?: "agent" | "customer" | "system" | null;
};

type StatusFilter = "active" | "open" | "pending" | "completed" | "all";
const PAGE = 60;
const CHANNEL_NAMES: Record<string, string> = { all: "All", whatsapp: "WhatsApp", messenger: "Messenger", instagram: "Instagram", sms: "SMS", web: "Web chat" };

/* ----------------------------------------------------------------- helpers */

function chatTone(conv: Conv, slaMinutes: number): { label: string; tone: string } | null {
  if (conv.status === "completed") return { label: "Completed", tone: "bg-success/10 text-success border-success/30" };
  if (!conv.assignedAgentId) return { label: "Queue", tone: "bg-warning/10 text-warning border-warning/30" };
  if (conv.lastSenderType === "customer") {
    const ageMin = conv.lastMessageAt ? Math.max(0, (Date.now() - new Date(conv.lastMessageAt).getTime()) / 60000) : 0;
    return ageMin >= slaMinutes
      ? { label: "Late", tone: "bg-destructive/10 text-destructive border-destructive/30" }
      : { label: "Waiting", tone: "bg-warning/10 text-warning border-warning/30" };
  }
  if (conv.status === "pending") return { label: "Replied", tone: "bg-info/10 text-info border-info/30" };
  return null;
}

function ChannelGlyph({ channel, className }: { channel?: string; className?: string }) {
  const c = (channel ?? "whatsapp").toLowerCase();
  const cls = cn("h-3.5 w-3.5 shrink-0", className);
  if (c === "messenger") return <FaFacebookMessenger className={cn(cls, "text-[#0084FF]")} aria-label="Messenger" />;
  if (c === "instagram") return <FaInstagram className={cn(cls, "text-[#E4405F]")} aria-label="Instagram" />;
  if (c === "sms") return <FaSms className={cn(cls, "text-muted-foreground")} aria-label="SMS" />;
  if (c === "web") return <Globe className={cn(cls, "text-info")} aria-label="Web chat" />;
  return <FaWhatsapp className={cn(cls, "text-[#25D366]")} aria-label="WhatsApp" />;
}

function listTime(iso?: string | null): string {
  if (!iso) return "";
  const d = parseISO(iso);
  if (isToday(d)) return format(d, "h:mm a");
  if (isYesterday(d)) return "Yesterday";
  return format(d, "d MMM");
}

function dayLabel(d: Date): string {
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEEE, d MMMM yyyy");
}

function customerTitle(c: { customer?: { name?: string | null; phone?: string | null } | null }): string {
  return c.customer?.name?.trim() || c.customer?.phone || "Unknown";
}

/* -------------------------------------------------------------------- page */

export default function ChatPage() {
  const [location, navigate] = useLocation();
  const searchString = useSearch();
  const { data: me } = useGetMe();
  const { toast } = useToast();

  const selectedConvId = useMemo(() => {
    const id = new URLSearchParams(searchString).get("conv");
    return id && /^\d+$/.test(id) ? Number(id) : null;
  }, [searchString]);

  const selectConv = useCallback(
    (id: number | null) => navigate(id ? `/chat?conv=${id}` : "/chat"),
    [navigate],
  );

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [visible, setVisible] = useState(PAGE);
  const [message, setMessage] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const wideDetails = useMediaQuery("(min-width: 1280px)");

  const { data: insights } = useInsights();
  const slaMinutes = insights?.slaMinutes ?? 15;

  const insertReply = useCallback((text: string) => {
    setMessage((prev) => {
      const trimmed = (prev ?? "").trim();
      return trimmed.length ? `${trimmed}\n${text}` : text;
    });
    setDetailsOpen(false);
  }, []);

  // Whole list is fetched once; filtering/sorting is client-side. Live updates
  // come from useInboxSync (AppLayout) invalidating this query on change only.
  const { data: convsRaw, isLoading, isError, refetch } = useListConversations(undefined, {
    query: { queryKey: getListConversationsQueryKey(), staleTime: 15_000 },
  });

  const channels = useMemo(() => {
    const set = new Set<string>();
    (convsRaw as Conv[] | undefined)?.forEach((c) => set.add(c.channel ?? "whatsapp"));
    return [...set];
  }, [convsRaw]);

  const conversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = ((convsRaw as Conv[] | undefined) ?? []).filter((c) => {
      if (statusFilter === "active" && c.status === "completed") return false;
      if (statusFilter !== "active" && statusFilter !== "all" && c.status !== statusFilter) return false;
      if (channelFilter !== "all" && (c.channel ?? "whatsapp") !== channelFilter) return false;
      if (!q) return true;
      return (
        (c.customer?.name ?? "").toLowerCase().includes(q) ||
        (c.customer?.phone ?? "").toLowerCase().includes(q) ||
        (c.lastMessage ?? "").toLowerCase().includes(q)
      );
    });
    // Latest activity first — new messages float to the top automatically.
    return rows.sort((a, b) => {
      const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return tb - ta || b.id - a.id;
    });
  }, [convsRaw, search, statusFilter, channelFilter]);

  useEffect(() => setVisible(PAGE), [search, statusFilter, channelFilter]);

  const showList = !selectedConvId; // on phones: list OR conversation

  return (
    <div className="flex h-full w-full min-h-0 bg-background overflow-hidden">
      {/* -------- Conversation list -------- */}
      <aside
        className={cn(
          "flex-col min-h-0 w-full md:w-[340px] lg:w-[380px] md:flex-shrink-0 md:border-r border-border bg-card",
          showList ? "flex" : "hidden md:flex",
        )}
        aria-label="Conversations"
      >
        <div className="p-3 sm:p-4 border-b border-border space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-lg tracking-tight">Inbox</h2>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-[130px] h-9 text-xs" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              placeholder="Search name, phone or message"
              aria-label="Search conversations"
              className="pl-9 h-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-chat-search"
            />
          </div>
          {channels.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar" role="group" aria-label="Channel">
              {["all", ...channels].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setChannelFilter(c)}
                  aria-pressed={channelFilter === c}
                  className={cn(
                    "h-8 px-3 rounded-full text-xs font-medium border flex items-center gap-1.5 whitespace-nowrap",
                    channelFilter === c ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted",
                  )}
                >
                  {c !== "all" && <ChannelGlyph channel={c} className="h-3 w-3" />}
                  <span>{CHANNEL_NAMES[c] ?? c}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <ScrollArea className="flex-1 min-h-0">
          {isLoading ? (
            <div className="p-4 space-y-4" aria-busy>
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="h-11 w-11 rounded-full flex-shrink-0" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : isError ? (
            <ErrorState title="Could not load conversations" hint="Check your connection and try again." onRetry={() => void refetch()} />
          ) : conversations.length === 0 ? (
            <EmptyState
              icon={<MessageSquare className="h-10 w-10" />}
              title={search ? "No matching conversations" : "No conversations yet"}
              hint={search ? "Try a different name, number or word." : "New WhatsApp messages will appear here automatically."}
            />
          ) : (
            <ul className="divide-y divide-border" data-testid="conversation-list">
              {conversations.slice(0, visible).map((conv) => {
                const tone = chatTone(conv, slaMinutes);
                const unread = conv.unreadCount > 0;
                const selected = selectedConvId === conv.id;
                return (
                  <li key={conv.id}>
                    <button
                      type="button"
                      onClick={() => selectConv(conv.id)}
                      aria-current={selected ? "true" : undefined}
                      className={cn(
                        "w-full text-left px-3 sm:px-4 py-3 min-h-[72px] flex gap-3 transition-colors hover:bg-muted/60",
                        selected && "bg-muted",
                      )}
                      data-testid={`btn-select-conv-${conv.id}`}
                    >
                      <Avatar className="h-11 w-11 shrink-0">
                        <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
                          {initials(customerTitle(conv))}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className={cn("text-sm truncate", unread ? "font-bold" : "font-medium")}>{customerTitle(conv)}</p>
                          <time className={cn("text-[11px] whitespace-nowrap", unread ? "text-primary font-semibold" : "text-muted-foreground")}>
                            {listTime(conv.lastMessageAt)}
                          </time>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className={cn("text-[13px] truncate flex-1", unread ? "text-foreground" : "text-muted-foreground")}>
                            {conv.lastSenderType === "agent" && <span className="text-muted-foreground">You: </span>}
                            {conv.lastMessage || "No messages yet"}
                          </p>
                          {unread && (
                            <span
                              className="min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold flex items-center justify-center shrink-0"
                              aria-label={`${conv.unreadCount} unread`}
                            >
                              {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1.5 min-w-0">
                          <ChannelGlyph channel={conv.channel} />
                          {tone && (
                            <Badge variant="outline" className={cn("text-[10px] px-1.5 h-[18px] font-medium border", tone.tone)}>
                              {tone.label}
                            </Badge>
                          )}
                          {conv.assignedAgent && (
                            <span className="text-[11px] text-muted-foreground truncate">{userLabel(conv.assignedAgent as AppUser)}</span>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
              {conversations.length > visible && (
                <li className="p-3">
                  <Button variant="outline" className="w-full h-10" onClick={() => setVisible((v) => v + PAGE)}>
                    Show more ({conversations.length - visible})
                  </Button>
                </li>
              )}
            </ul>
          )}
        </ScrollArea>
      </aside>

      {/* -------- Conversation -------- */}
      <section className={cn("flex-1 min-w-0 min-h-0 flex-col", selectedConvId ? "flex" : "hidden md:flex")}>
        {selectedConvId ? (
          <ChatCenter
            key={selectedConvId}
            conversationId={selectedConvId}
            currentUser={me as AppUser | undefined}
            message={message}
            setMessage={setMessage}
            onBack={() => selectConv(null)}
            onOpenDetails={() => setDetailsOpen(true)}
            showDetailsButton={!wideDetails}
          />
        ) : (
          <EmptyState
            className="flex-1"
            icon={<MessageSquare className="h-12 w-12" />}
            title="Select a conversation"
            hint="Choose a chat from the list to read and reply."
          />
        )}
      </section>

      {/* -------- Details: docked on wide screens, drawer otherwise -------- */}
      {selectedConvId && wideDetails && (
        <aside className="w-[320px] flex-shrink-0 border-l border-border min-h-0" aria-label="Conversation details">
          <ChatContextPanel conversationId={selectedConvId} onInsertReply={insertReply} />
        </aside>
      )}
      {selectedConvId && !wideDetails && (
        <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
          <SheetContent side="right" className="p-0 w-full sm:max-w-sm">
            <SheetHeader className="sr-only">
              <SheetTitle>Conversation details</SheetTitle>
              <SheetDescription>Customer, tags, assignment and quick replies</SheetDescription>
            </SheetHeader>
            <ChatContextPanel conversationId={selectedConvId} onInsertReply={insertReply} />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ conversation */

function StatusTicks({ status }: { status?: string }) {
  if (status === "failed") return <AlertCircle className="h-3.5 w-3.5 text-destructive" aria-label="Not delivered" />;
  if (status === "read") return <CheckCheck className="h-3.5 w-3.5 text-info" aria-label="Read" />;
  if (status === "delivered") return <CheckCheck className="h-3.5 w-3.5 opacity-70" aria-label="Delivered" />;
  return <Check className="h-3.5 w-3.5 opacity-70" aria-label="Sent" />;
}

function ChatCenter({
  conversationId,
  currentUser,
  message,
  setMessage,
  onBack,
  onOpenDetails,
  showDetailsButton,
}: {
  conversationId: number;
  currentUser?: AppUser;
  message: string;
  setMessage: React.Dispatch<React.SetStateAction<string>>;
  onBack: () => void;
  onOpenDetails: () => void;
  showDetailsButton: boolean;
}) {
  const [isNote, setIsNote] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [atBottom, setAtBottom] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastCountRef = useRef(0);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const uploadMut = useUploadAttachment();
  const { data: perms } = useMyPermissions();
  const canSend = perms?.canSendMessages !== false;
  const currentUserName = currentUser ? userLabel(currentUser) : undefined;

  const { data: conv, isLoading: convLoading, isError: convError, refetch: refetchConv } = useGetConversation(conversationId, {
    query: { enabled: !!conversationId, queryKey: getGetConversationQueryKey(conversationId), staleTime: 5_000 },
  });
  const { data: messages, isLoading: msgsLoading, isError: msgsError, refetch: refetchMsgs, append } = useThread(conversationId);

  const { typingAgent, handleTyping } = useTypingIndicator();
  const onSocketMessage = useCallback((msg: unknown) => append(msg as Message), [append]);
  useConversationSocket(conversationId, onSocketMessage, handleTyping, currentUserName);
  const emitTyping = useTypingEmit(conversationId, currentUserName);

  const sendMessageMut = useSendMessage();
  const resolveMut = useResolveConversation();
  const assignMut = useAssignConversation();
  const patchMut = usePatchConversation();

  const isAssignedToMe = !!conv?.assignedAgentId && conv.assignedAgentId === currentUser?.id;
  const isAdmin = currentUser?.role === "admin";
  const mustClaim = !!conv && !conv.assignedAgentId && !isAdmin;
  const channel = (conv as { channel?: string } | undefined)?.channel ?? "whatsapp";

  // ---- mark read (only while the tab is visible) ----
  const unread = conv?.unreadCount ?? 0;
  useEffect(() => {
    if (!conv || unread === 0 || mustClaim) return;
    if (document.visibilityState !== "visible") return;
    let cancelled = false;
    markConversationRead(conversationId)
      .then(() => {
        if (cancelled) return;
        void queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
        void queryClient.invalidateQueries({ queryKey: ["/api/inbox/sync"] });
      })
      .catch(() => { /* non-critical */ });
    return () => { cancelled = true; };
  }, [conversationId, unread, conv, mustClaim, queryClient, messages?.length]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refetchMsgs();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refetchMsgs]);

  // ---- scrolling: stick to bottom only if the user is already there ----
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
  };
  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);
  useEffect(() => {
    const n = messages?.length ?? 0;
    if (n === 0) return;
    const first = lastCountRef.current === 0;
    const lastMsg = messages![n - 1];
    if (first || atBottom || lastMsg.senderType === "agent") scrollToBottom(!first);
    lastCountRef.current = n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages?.length]);

  // ---- composer ----
  const autosize = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  };
  useEffect(autosize, [message]);

  const invalidateLists = () => {
    void queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
    void queryClient.invalidateQueries({ queryKey: ["/api/inbox/sync"] });
  };

  const handleSend = () => {
    if (sendMessageMut.isPending) return;
    if (!message.trim() && attachments.length === 0) return;
    if (!canSend) {
      toast({ title: "You do not have permission to send messages", variant: "destructive" });
      return;
    }
    sendMessageMut.mutate(
      { id: conversationId, data: { body: message.trim() || "(attachment)", isNote, attachments } },
      {
        onSuccess: (sent) => {
          append(sent as Message);
          setMessage("");
          setIsNote(false);
          setAttachments([]);
          invalidateLists();
          const err = (sent as { deliveryError?: string }).deliveryError;
          if (err) {
            toast({
              title: "Message saved but not delivered",
              description: /131047|24/.test(err)
                ? "WhatsApp only allows free-form replies within 24 hours of the customer's last message."
                : err,
              variant: "destructive",
            });
          }
          requestAnimationFrame(() => textareaRef.current?.focus());
        },
        onError: (e) =>
          toast({
            title: "Message was not sent",
            description: (e as { data?: { error?: string } }).data?.error ?? "Check your connection and try again.",
            variant: "destructive",
          }),
      },
    );
  };

  const coarsePointer = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Phones: Enter = new line (use the Send button). Desktop: Enter sends.
    if (e.key === "Enter" && !e.shiftKey && !coarsePointer) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 400_000) {
      toast({ title: "File too large (max 400KB)", variant: "destructive" });
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      uploadMut.mutate(
        { dataUrl: reader.result as string, filename: file.name },
        {
          onSuccess: (res) => setAttachments((prev) => [...prev, res.url]),
          onError: () => toast({ title: "Upload failed", variant: "destructive" }),
        },
      );
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleResolve = () => {
    resolveMut.mutate({ id: conversationId }, {
      onSuccess: () => { toast({ title: "Conversation completed" }); invalidateLists(); },
      onError: () => toast({ title: "Could not complete the conversation", variant: "destructive" }),
    });
  };
  const handleReopen = () => {
    patchMut.mutate({ id: conversationId, data: { status: "open" } }, {
      onSuccess: () => { toast({ title: "Conversation reopened" }); invalidateLists(); },
      onError: () => toast({ title: "Could not reopen", variant: "destructive" }),
    });
  };
  const handleClaim = () => {
    if (!currentUser) return;
    assignMut.mutate({ id: conversationId, data: { agentId: currentUser.id } }, {
      onSuccess: () => { toast({ title: "Conversation assigned to you" }); invalidateLists(); },
      onError: () => toast({ title: "Could not claim this conversation", variant: "destructive" }),
    });
  };

  // ---- 24h WhatsApp window ----
  const lastCustomerAt = useMemo(() => {
    const m = [...(messages ?? [])].reverse().find((x) => x.senderType === "customer");
    return m ? parseISO(m.createdAt) : null;
  }, [messages]);
  const outsideWindow =
    channel === "whatsapp" && !isNote && (!lastCustomerAt || differenceInHours(new Date(), lastCustomerAt) >= 24);

  // ---- grouped rows with date separators ----
  const rows = useMemo(() => {
    const out: ({ kind: "day"; key: string; label: string } | { kind: "msg"; key: string; msg: Message })[] = [];
    let lastDay = "";
    for (const m of messages ?? []) {
      const d = parseISO(m.createdAt);
      const dk = format(d, "yyyy-MM-dd");
      if (dk !== lastDay) {
        out.push({ kind: "day", key: `d-${dk}`, label: dayLabel(d) });
        lastDay = dk;
      }
      out.push({ kind: "msg", key: `m-${m.id}`, msg: m });
    }
    return out;
  }, [messages]);

  if (convError || msgsError) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="h-14 px-2 border-b border-border flex items-center md:hidden">
          <Button variant="ghost" size="icon" className="h-11 w-11" onClick={onBack} aria-label="Back to conversations"><ChevronLeft className="h-5 w-5" /></Button>
        </div>
        <ErrorState
          className="flex-1"
          title="Could not open this conversation"
          hint="It may have been removed, or you may not have access to it."
          onRetry={() => { void refetchConv(); void refetchMsgs(); }}
        />
      </div>
    );
  }

  const title = conv ? customerTitle(conv) : "";

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      {/* Header */}
      <header className="min-h-14 px-2 sm:px-4 py-2 border-b border-border flex items-center gap-2 bg-card flex-shrink-0 pt-safe">
        <Button variant="ghost" size="icon" className="h-11 w-11 md:hidden shrink-0" onClick={onBack} aria-label="Back to conversations" data-testid="btn-back">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">{initials(title)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          {convLoading ? <Skeleton className="h-4 w-32" /> : (
            <>
              <h3 className="text-sm font-semibold truncate">{title}</h3>
              <p className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                <ChannelGlyph channel={channel} className="h-3 w-3" />
                {conv?.customer?.phone}
                <span aria-hidden className="hidden sm:inline">·</span>
                <span className="hidden sm:inline truncate">
                  {conv?.assignedAgent ? userLabel(conv.assignedAgent as AppUser) : <span className="text-warning font-medium">Unassigned</span>}
                </span>
              </p>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {conv && conv.status !== "completed" && (isAssignedToMe || isAdmin) && (
            <Button size="sm" variant="outline" className="h-9" onClick={handleResolve} disabled={resolveMut.isPending} data-testid="btn-resolve">
              <CheckCircle2 className="h-4 w-4 sm:mr-2 text-success" />
              <span className="hidden sm:inline">Resolve</span>
            </Button>
          )}
          {showDetailsButton && (
            <Button size="icon" variant="ghost" className="h-10 w-10" onClick={onOpenDetails} aria-label="Conversation details" data-testid="btn-details">
              <PanelRight className="h-5 w-5" />
            </Button>
          )}
        </div>
      </header>

      {/* Messages */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="absolute inset-0 overflow-y-auto overscroll-contain bg-wallpaper px-3 sm:px-6 py-4"
          role="log"
          aria-live="polite"
          aria-label="Messages"
          data-testid="message-list"
        >
          <div className="max-w-3xl mx-auto space-y-1.5">
            {msgsLoading && (
              <div className="space-y-3 py-6" aria-busy>
                <Skeleton className="h-10 w-2/3" />
                <Skeleton className="h-10 w-1/2 ml-auto" />
                <Skeleton className="h-10 w-3/5" />
              </div>
            )}
            {!msgsLoading && rows.length === 0 && (
              <EmptyState title="No messages yet" hint="Write the first message below." />
            )}
            {rows.map((row) => {
              if (row.kind === "day") {
                return (
                  <div key={row.key} className="flex justify-center py-2">
                    <span className="bg-card/90 border border-border text-muted-foreground text-[11px] font-medium px-3 py-1 rounded-full shadow-sm">
                      {row.label}
                    </span>
                  </div>
                );
              }
              const msg = row.msg;
              const isMe = msg.senderType === "agent";
              if (msg.senderType === "system") {
                return (
                  <div key={row.key} className="flex justify-center py-1">
                    <span className="bg-muted px-3 py-1 rounded-full text-xs text-muted-foreground">{msg.body}</span>
                  </div>
                );
              }
              if (msg.isNote) {
                return (
                  <div key={row.key} className="flex justify-center py-1.5">
                    <div className="bg-warning/10 border border-warning/30 rounded-lg px-3 py-2 max-w-lg w-full">
                      <div className="flex items-center gap-2 mb-1">
                        <Clock className="h-3 w-3 text-warning" aria-hidden />
                        <span className="text-xs font-semibold text-warning">Internal note</span>
                        <time className="text-[11px] text-muted-foreground ml-auto">{format(parseISO(msg.createdAt), "h:mm a")}</time>
                      </div>
                      <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>
                    </div>
                  </div>
                );
              }
              const failed = (msg.status as string) === "failed";
              return (
                <div key={row.key} className={cn("flex", isMe ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] sm:max-w-[70%] rounded-2xl px-3.5 py-2 shadow-sm",
                      isMe ? "bg-bubble-out text-bubble-out-foreground rounded-br-md" : "bg-bubble-in text-bubble-in-foreground border border-border rounded-bl-md",
                      failed && "ring-2 ring-destructive/60",
                    )}
                  >
                    <p className="text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{msg.body}</p>
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="mt-1.5 flex flex-col gap-1">
                        {msg.attachments.map((url, i) =>
                          /^data:image|\.(png|jpe?g|gif|webp)$/i.test(url) ? (
                            <img key={i} src={url} alt="Attachment" className="rounded-lg max-h-56 object-contain" loading="lazy" />
                          ) : (
                            <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="text-xs underline break-all">Attachment {i + 1}</a>
                          ),
                        )}
                      </div>
                    )}
                    <div className={cn("flex items-center justify-end gap-1 mt-0.5 text-[11px]", isMe ? "opacity-80" : "text-muted-foreground")}>
                      <time>{format(parseISO(msg.createdAt), "h:mm a")}</time>
                      {isMe && <StatusTicks status={msg.status} />}
                    </div>
                    {failed && <p className="text-[11px] font-semibold mt-0.5 text-right">Not delivered</p>}
                  </div>
                </div>
              );
            })}
            {typingAgent && (
              <div className="flex justify-start" data-testid="typing-indicator">
                <span className="text-xs text-muted-foreground italic px-2">{typingAgent} is typing…</span>
              </div>
            )}
          </div>
        </div>
        {!atBottom && rows.length > 0 && (
          <Button
            size="icon"
            variant="secondary"
            className="absolute bottom-3 right-4 h-10 w-10 rounded-full shadow-md border border-border"
            onClick={() => scrollToBottom()}
            aria-label="Jump to latest message"
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Composer */}
      {conv?.status === "completed" ? (
        <div className="p-3 bg-card border-t border-border flex items-center justify-between gap-3 pb-safe">
          <p className="text-sm text-muted-foreground">This conversation is completed.</p>
          <Button size="sm" variant="outline" onClick={handleReopen} disabled={patchMut.isPending}>
            <RotateCcw className="h-4 w-4 mr-2" /> Reopen
          </Button>
        </div>
      ) : mustClaim ? (
        <div className="p-3 bg-card border-t border-border flex items-center justify-between gap-3 pb-safe">
          <p className="text-sm text-muted-foreground">This chat is in the queue. Claim it to reply.</p>
          <Button size="sm" onClick={handleClaim} disabled={assignMut.isPending} data-testid="btn-assign-me">Claim</Button>
        </div>
      ) : (
        <div className="bg-card border-t border-border px-2 sm:px-4 pt-2 pb-2 pb-safe">
          {outsideWindow && (
            <p role="status" className="max-w-3xl mx-auto mb-2 rounded-md bg-warning/10 border border-warning/30 px-3 py-1.5 text-xs text-warning">
              More than 24 hours since the customer's last message — WhatsApp may reject a normal reply. Use an internal note, or wait for the customer to write.
            </p>
          )}
          {!conv?.assignedAgentId && isAdmin && (
            <div className="max-w-3xl mx-auto mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>Unassigned chat.</span>
              <Button size="sm" variant="outline" className="h-8" onClick={handleClaim} disabled={assignMut.isPending} data-testid="btn-assign-me">Assign to me</Button>
            </div>
          )}
          <div
            className={cn(
              "max-w-3xl mx-auto rounded-xl border bg-background focus-within:ring-2 focus-within:ring-ring overflow-hidden",
              isNote ? "border-warning/50" : "border-input",
            )}
          >
            {isNote && (
              <div className="bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning border-b border-warning/30 flex items-center">
                <Clock className="h-3 w-3 mr-1.5" aria-hidden /> Internal note — not sent to the customer
              </div>
            )}
            <Textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => { setMessage(e.target.value); emitTyping(); }}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder={isNote ? "Write an internal note…" : "Type a message"}
              aria-label={isNote ? "Internal note" : "Message"}
              className="min-h-[48px] max-h-40 border-0 focus-visible:ring-0 focus-visible:ring-offset-0 resize-none rounded-none text-base sm:text-sm p-3 bg-transparent"
              data-testid="input-chat-message"
            />
            <div className="flex items-center justify-between px-2 py-1.5 border-t border-border">
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn("h-10 px-3 text-xs", isNote && "bg-warning/15 text-warning")}
                  onClick={() => setIsNote((v) => !v)}
                  aria-pressed={isNote}
                >
                  <Clock className="h-3.5 w-3.5 mr-1.5" /> Note
                </Button>
                <Button type="button" variant="ghost" size="icon" className="h-10 w-10 text-muted-foreground" onClick={() => fileInputRef.current?.click()} disabled={!canSend || uploadMut.isPending} aria-label="Attach a file">
                  {uploadMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                </Button>
                <input ref={fileInputRef} type="file" accept="image/*,.pdf,.txt" className="hidden" onChange={handleFileSelect} />
                {attachments.length > 0 && (
                  <button type="button" className="text-xs text-muted-foreground flex items-center gap-1" onClick={() => setAttachments([])} aria-label="Remove attachments">
                    {attachments.length} file(s) <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <Button
                type="button"
                className="h-10 px-5"
                onClick={handleSend}
                disabled={(!message.trim() && attachments.length === 0) || sendMessageMut.isPending || !canSend}
                data-testid="btn-send-message"
              >
                {sendMessageMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 sm:mr-2" />}
                <span className="hidden sm:inline">Send</span>
                <span className="sr-only sm:hidden">Send</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ChatContextPanel({ conversationId, onInsertReply }: { conversationId: number, onInsertReply: (text: string) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [tagInput, setTagInput] = useState("");
  const [showTagInput, setShowTagInput] = useState(false);
  const { data: conv } = useGetConversation(conversationId, {
    query: { enabled: !!conversationId, queryKey: getGetConversationQueryKey(conversationId) }
  });
  const { data: quickReplies } = useListQuickReplies();
  const [replySearch, setReplySearch] = useState("");
  const { data: users } = useListUsers();
  const { data: me } = useGetMe();
  const { data: allTags } = useListTags();
  const customer = conv?.customer;

  const filteredReplies = (quickReplies ?? []).filter((qr) => {
    if (!replySearch.trim()) return true;
    const q = replySearch.toLowerCase();
    return qr.title.toLowerCase().includes(q) || qr.body.toLowerCase().includes(q);
  });

  const patchMut = usePatchConversation();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
    queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
  };

  const handleStatusChange = (status: string) => {
    patchMut.mutate(
      { id: conversationId, data: { status: status as "open" | "pending" | "completed" } },
      {
        onSuccess: () => { invalidate(); toast({ title: "Status updated" }); },
        onError: () => toast({ title: "Failed to update status", variant: "destructive" })
      }
    );
  };

  const handleAssign = (value: string) => {
    const assignedAgentId = value === "unassigned" ? null : Number(value);
    patchMut.mutate(
      { id: conversationId, data: { assignedAgentId } },
      {
        onSuccess: () => { invalidate(); toast({ title: assignedAgentId ? "Conversation assigned" : "Conversation unassigned" }); },
        onError: () => toast({ title: "Failed to assign conversation", variant: "destructive" })
      }
    );
  };

  const handleRemoveTag = (tag: string) => {
    const newTags = (conv?.tags || []).filter(t => t !== tag);
    patchMut.mutate(
      { id: conversationId, data: { tags: newTags } },
      {
        onSuccess: () => invalidate(),
        onError: () => toast({ title: "Failed to remove tag", variant: "destructive" })
      }
    );
  };

  const handleAddTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    const currentTags = conv?.tags || [];
    if (currentTags.includes(trimmed)) return;
    const newTags = [...currentTags, trimmed];
    patchMut.mutate(
      { id: conversationId, data: { tags: newTags } },
      {
        onSuccess: () => { invalidate(); setTagInput(""); setShowTagInput(false); },
        onError: () => toast({ title: "Failed to add tag", variant: "destructive" })
      }
    );
  };

  const suggestedTags = allTags?.filter(t => !conv?.tags?.includes(t.name)) || [];

  return (
    <div className="w-full h-full flex flex-col bg-card overflow-hidden min-h-0">
      <Tabs defaultValue="details" className="flex-1 flex flex-col min-h-0">
        <TabsList className="w-full justify-start h-12 rounded-none border-b border-border bg-transparent px-2 sm:px-4">
          <TabsTrigger value="details" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4">Details</TabsTrigger>
          <TabsTrigger value="replies" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4">Quick Replies</TabsTrigger>
        </TabsList>
        
        <TabsContent value="details" className="flex-1 overflow-y-auto m-0 p-0">
          <div className="p-6 space-y-6">
            {/* Conversation Management */}
            <div className="space-y-4">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Conversation</h4>
              
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Status</label>
                  <Select value={conv?.status || "open"} onValueChange={handleStatusChange} disabled={patchMut.isPending}>
                    <SelectTrigger className="h-8 text-xs bg-background" data-testid="select-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Assigned To</label>
                  <Select
                    value={conv?.assignedAgentId ? String(conv.assignedAgentId) : "unassigned"}
                    onValueChange={handleAssign}
                    disabled={patchMut.isPending || me?.role !== "admin"}
                  >
                    <SelectTrigger className="h-8 text-xs bg-background" data-testid="select-assignee">
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {users?.filter((u) => (u as AppUser).isActive !== false).map(u => (
                        <SelectItem key={u.id} value={String(u.id)}>{userLabel(u as AppUser)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Reason</label>
              <div><ChatReasonPicker conversationId={conversationId} currentReasonId={(conv as { chatReasonId?: number | null } | undefined)?.chatReasonId ?? null} /></div>
            </div>

            <Separator />

            {/* Conversation Tags */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tags</h4>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setShowTagInput(!showTagInput)}
                  data-testid="btn-add-tag"
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {conv?.tags?.map((tag, idx) => (
                  <Badge key={idx} variant="secondary" className="font-normal text-xs pr-1 gap-1">
                    {tag}
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className="ml-0.5 hover:text-destructive transition-colors"
                      data-testid={`btn-remove-tag-${tag}`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </Badge>
                ))}
                {!conv?.tags?.length && !showTagInput && (
                  <span className="text-xs text-muted-foreground">No tags</span>
                )}
              </div>
              {showTagInput && (
                <div className="space-y-2">
                  <div className="flex gap-1">
                    <Input
                      value={tagInput}
                      onChange={e => setTagInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAddTag(tagInput); } }}
                      placeholder="Add tag..."
                      className="h-7 text-xs bg-background"
                      autoFocus
                      data-testid="input-tag"
                    />
                    <Button
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => handleAddTag(tagInput)}
                      disabled={!tagInput.trim() || patchMut.isPending}
                    >
                      Add
                    </Button>
                  </div>
                  {suggestedTags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {suggestedTags.slice(0, 6).map(t => (
                        <button
                          key={t.id}
                          onClick={() => handleAddTag(t.name)}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
                          data-testid={`btn-suggest-tag-${t.name}`}
                        >
                          {t.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <Separator />

            {/* Customer info */}
            <div className="flex flex-col items-center text-center">
              <Avatar className="h-16 w-16 mb-3 border-2 border-border shadow-sm">
                <AvatarFallback className="text-lg bg-primary/10 text-primary">{customer?.name?.substring(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <h3 className="font-semibold text-base">{customer?.name}</h3>
              <p className="text-sm text-muted-foreground">Customer</p>
            </div>

            <Separator />

            <div className="space-y-4">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Contact Info</h4>
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span>{customer?.phone}</span>
                </div>
                {customer?.branch && (
                  <div className="flex items-center gap-3">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <span>{customer.branch} Branch</span>
                  </div>
                )}
              </div>
            </div>

            {(customer?.notes || customer?.prescriptionNotes) && (
              <>
                <Separator />
                <div className="space-y-4">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notes</h4>
                  {customer.prescriptionNotes && (
                    <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-md border border-blue-100 dark:border-blue-800/50">
                      <p className="text-xs font-semibold text-blue-800 dark:text-blue-300 mb-1">Prescription notes</p>
                      <p className="text-sm text-blue-900 dark:text-blue-100">{customer.prescriptionNotes}</p>
                    </div>
                  )}
                  {customer.notes && (
                    <div className="bg-muted/50 p-3 rounded-md">
                      <p className="text-xs font-semibold mb-1">General Notes</p>
                      <p className="text-sm">{customer.notes}</p>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="replies" className="flex-1 m-0 p-0 min-h-0 flex flex-col data-[state=inactive]:hidden">
          <div className="p-4 pb-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search replies..."
                className="pl-8 h-9 text-sm bg-background"
                value={replySearch}
                onChange={(e) => setReplySearch(e.target.value)}
                data-testid="input-quick-reply-search"
              />
            </div>
          </div>
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-4 space-y-3">
              {filteredReplies.map((qr) => (
                <button
                  key={qr.id}
                  type="button"
                  onClick={() => onInsertReply(qr.body)}
                  className="w-full text-left p-3 border border-border rounded-lg bg-card hover:border-primary/50 hover:bg-primary/5 cursor-pointer transition-colors group focus:outline-none focus:ring-2 focus:ring-ring"
                  data-testid={`btn-quick-reply-${qr.id}`}
                >
                  <h5 className="font-medium text-sm mb-1">{qr.title}</h5>
                  <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">{qr.body}</p>
                  <span className="block w-full mt-2 h-7 leading-7 text-xs opacity-0 group-hover:opacity-100 transition-opacity text-primary text-center font-medium">
                    Click to insert
                  </span>
                </button>
              ))}
              {filteredReplies.length === 0 && (
                <p className="text-sm text-muted-foreground text-center mt-8">
                  {replySearch ? "No matching replies." : "No quick replies configured."}
                </p>
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "open":
      return <Badge variant="default" className="text-[9px] px-1 h-4 bg-primary text-primary-foreground hover:bg-primary">Open</Badge>;
    case "completed":
      return <Badge variant="secondary" className="text-[9px] px-1 h-4 bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400">Completed</Badge>;
    case "pending":
      return <Badge variant="secondary" className="text-[9px] px-1 h-4 bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400">Pending</Badge>;
    default:
      return null;
  }
}
// ---------------------------------------------------------------------------
// Chat Reason Picker — shown in conversation header. Lets the agent tag the
// conversation with a categorized reason (e.g. Refill, Complaint).
// ---------------------------------------------------------------------------
function ChatReasonPicker({
  conversationId,
  currentReasonId,
}: {
  conversationId: number;
  currentReasonId: number | null;
}) {
  const { data: reasons } = useChatReasons();
  const patchMut = usePatchConversation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  if (!conversationId) return null;
  const current = reasons?.find((r) => r.id === currentReasonId) ?? null;

  const setReason = (id: number | null) => {
    patchMut.mutate(
      { id: conversationId, data: { chatReasonId: id } as never },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
          queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
          toast({ title: id ? "Chat reason updated" : "Chat reason cleared" });
        },
        onError: (err) => {
          toast({
            title: "Failed to update reason",
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-2 text-xs font-medium"
          data-testid="btn-chat-reason"
        >
          {current ? (
            <>
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: current.color }} />
              {current.nameEn}
            </>
          ) : (
            <>
              <TagIcon className="h-3.5 w-3.5" />
              Set reason
            </>
          )}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 max-h-80 overflow-y-auto">
        {currentReasonId !== null && (
          <>
            <DropdownMenuItem onClick={() => setReason(null)} data-testid="reason-clear">
              <X className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
              Clear reason
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {reasons?.length ? (
          reasons.map((r) => (
            <DropdownMenuItem
              key={r.id}
              onClick={() => setReason(r.id)}
              data-testid={`reason-${r.id}`}
            >
              <span className="w-2 h-2 rounded-full mr-2" style={{ backgroundColor: r.color }} />
              <span className="flex-1">{r.nameEn}</span>
              {r.categoryTitleEn && (
                <span className="text-[10px] text-muted-foreground ml-2">{r.categoryTitleEn}</span>
              )}
            </DropdownMenuItem>
          ))
        ) : (
          <div className="px-2 py-2 text-xs text-muted-foreground">No reasons configured</div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
