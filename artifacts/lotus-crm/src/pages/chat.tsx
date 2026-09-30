import React, { useState, useEffect, useRef, useCallback } from "react";
import { 
  useListConversations, 
  useGetConversation, 
  useListMessages, 
  useSendMessage,
  useAssignConversation,
  useResolveConversation,
  usePatchConversation,
  useListUsers,
  useListTags,
  useListQuickReplies,
  useGetMe,
  getListMessagesQueryKey,
  getListConversationsQueryKey,
  getGetConversationQueryKey
} from "@workspace/api-client-react";
import { useConversationSocket, useTypingEmit, useTypingIndicator } from "@/hooks/use-socket";
import { format, parseISO } from "date-fns";
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
  MessageSquarePlus,
  MessageSquare,
  X,
  Plus,
  ChevronDown
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
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { FaWhatsapp, FaFacebookMessenger, FaInstagram, FaSms } from "react-icons/fa";
import { Globe } from "lucide-react";
import { useSearch } from "wouter";
import { useInsights, useChatReasons, useUploadAttachment, useMyPermissions } from "@/lib/api-extra";

type ConvWithChannel = {
  id: number;
  channel?: string;
  lastSenderType?: "agent" | "customer" | "system" | null;
  lastMessageAt?: string | null;
  status: string;
};

function getChatStatus(
  conv: ConvWithChannel,
  slaMinutes: number,
): { label: "Waiting" | "Late" | "Replied" | "Completed" | "Pending"; tone: string } {
  if (conv.status === "completed")
    return { label: "Completed", tone: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" };
  if (conv.status === "pending")
    return { label: "Pending", tone: "bg-slate-500/10 text-slate-600 border-slate-500/20" };
  if (conv.lastSenderType === "customer") {
    const ageMin = conv.lastMessageAt
      ? Math.max(0, (Date.now() - new Date(conv.lastMessageAt).getTime()) / 60000)
      : 0;
    if (ageMin >= slaMinutes)
      return { label: "Late", tone: "bg-rose-500/10 text-rose-600 border-rose-500/20 animate-pulse" };
    return { label: "Waiting", tone: "bg-amber-500/10 text-amber-600 border-amber-500/20" };
  }
  return { label: "Replied", tone: "bg-blue-500/10 text-blue-600 border-blue-500/20" };
}

function ChannelGlyph({ channel }: { channel?: string }) {
  const c = (channel ?? "whatsapp").toLowerCase();
  if (c === "messenger") return <FaFacebookMessenger className="h-3.5 w-3.5 text-blue-500" />;
  if (c === "instagram") return <FaInstagram className="h-3.5 w-3.5 text-pink-500" />;
  if (c === "sms") return <FaSms className="h-3.5 w-3.5 text-slate-500" />;
  if (c === "web") return <Globe className="h-3.5 w-3.5 text-purple-500" />;
  return <FaWhatsapp className="h-3.5 w-3.5 text-emerald-500" />;
}

export default function ChatPage() {
  const [selectedConvId, setSelectedConvId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "completed" | "pending">("open");
  const [message, setMessage] = useState("");
  const { data: user } = useGetMe();

  // ?channel=whatsapp|messenger|... — set from sidebar links.
  // ?conv=NNN — deep-link from AI Insights page to open a specific chat.
  const searchString = useSearch();
  const channelFilter = React.useMemo(() => {
    const v = new URLSearchParams(searchString).get("channel");
    return v && ["whatsapp", "messenger", "instagram", "sms", "web"].includes(v) ? v : null;
  }, [searchString]);
  useEffect(() => {
    const id = new URLSearchParams(searchString).get("conv");
    if (id && /^\d+$/.test(id)) setSelectedConvId(Number(id));
  }, [searchString]);

  const { data: insights } = useInsights();
  const slaMinutes = insights?.slaMinutes ?? 15;

  const insertReply = useCallback((text: string) => {
    setMessage((prev) => {
      const trimmed = (prev ?? "").trim();
      return trimmed.length ? `${trimmed}\n${text}` : text;
    });
  }, []);

  const { data: convsRaw, isLoading: convLoading } = useListConversations({
    status: statusFilter === "all" ? undefined : statusFilter,
    search: search || undefined
  });

  // Channel filter is applied client-side: API list endpoint already returns
  // `channel` for every row (added to the select), so we filter here without
  // a round-trip and keep React Query's cache key stable.
  const conversations = React.useMemo(() => {
    if (!convsRaw) return convsRaw;
    if (!channelFilter) return convsRaw;
    return convsRaw.filter(
      (c) => ((c as unknown as { channel?: string }).channel ?? "whatsapp") === channelFilter,
    );
  }, [convsRaw, channelFilter]);

  return (
    <div className="flex h-full w-full bg-background overflow-hidden">
      {/* Left Sidebar - Conversation List */}
      <div className="w-80 flex-shrink-0 border-r border-border flex flex-col bg-sidebar">
        <div className="p-4 border-b border-border flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-lg tracking-tight flex items-center gap-2">
              Inbox
              {channelFilter && (
                <Badge variant="outline" className="text-[10px] capitalize gap-1 font-normal">
                  <ChannelGlyph channel={channelFilter} />
                  {channelFilter}
                </Badge>
              )}
            </h2>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="w-[110px] h-8 text-xs bg-background">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search patients..."
              className="pl-8 bg-background"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-chat-search"
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          {convLoading ? (
            <div className="p-4 space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : conversations?.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground flex flex-col items-center">
              <MessageSquare className="h-10 w-10 mb-2 opacity-20" />
              <p className="text-sm">No conversations found.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {conversations?.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => setSelectedConvId(conv.id)}
                  className={`w-full text-left p-4 hover:bg-muted/50 transition-colors flex gap-3 ${selectedConvId === conv.id ? 'bg-muted' : ''}`}
                  data-testid={`btn-select-conv-${conv.id}`}
                >
                  <Avatar className="h-10 w-10 border border-border/50">
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {conv.customer?.name?.substring(0, 2).toUpperCase() || 'CU'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="flex justify-between items-baseline mb-1">
                      <p className="text-sm font-semibold truncate text-foreground">{conv.customer?.name}</p>
                      <p className="text-[10px] text-muted-foreground whitespace-nowrap ml-2">
                        {conv.lastMessageAt ? format(parseISO(conv.lastMessageAt), "h:mm a") : ''}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mb-2">
                      {conv.lastMessage || "No messages yet"}
                    </p>
                    <div className="flex gap-1 items-center overflow-x-auto no-scrollbar pb-1">
                      <ChannelGlyph channel={(conv as unknown as { channel?: string }).channel} />
                      {(() => {
                        const s = getChatStatus(conv as unknown as ConvWithChannel, slaMinutes);
                        return (
                          <Badge variant="outline" className={`text-[9px] px-1.5 h-4 border ${s.tone}`}>
                            {s.label}
                          </Badge>
                        );
                      })()}
                      {conv.tags?.slice(0, 2).map((tag, idx) => (
                        <Badge key={idx} variant="outline" className="text-[9px] px-1 h-4 bg-background">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  {conv.unreadCount > 0 && (
                    <div className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center flex-shrink-0 self-center">
                      {conv.unreadCount}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Center - Chat Area */}
      {selectedConvId ? (
        <ChatCenter conversationId={selectedConvId} currentUserId={user?.id} currentUserName={user?.name ?? undefined} message={message} setMessage={setMessage} />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center bg-muted/10 text-muted-foreground border-r border-border">
          <MessageSquarePlus className="h-12 w-12 mb-4 opacity-20" />
          <h3 className="text-lg font-medium text-foreground">Select a conversation</h3>
          <p className="text-sm">Choose a patient from the list to start messaging</p>
        </div>
      )}

      {/* Right - Context Panel */}
      {selectedConvId && (
        <ChatContextPanel conversationId={selectedConvId} onInsertReply={insertReply} />
      )}
    </div>
  );
}

function ChatCenter({ conversationId, currentUserId, currentUserName, message, setMessage }: { conversationId: number, currentUserId?: number, currentUserName?: string, message: string, setMessage: React.Dispatch<React.SetStateAction<string>> }) {
  const [isNote, setIsNote] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const uploadMut = useUploadAttachment();
  const { data: perms } = useMyPermissions();
  const canSend = perms?.canSendMessages !== false;

  const { data: conv, isLoading: convLoading } = useGetConversation(conversationId, {
    query: { enabled: !!conversationId, queryKey: getGetConversationQueryKey(conversationId) }
  });
  
  const { data: messages, isLoading: msgsLoading } = useListMessages(conversationId, {
    query: { enabled: !!conversationId, queryKey: getListMessagesQueryKey(conversationId) }
  });

  // Typing indicator state
  const { typingAgent, handleTyping } = useTypingIndicator();

  // Real-time: listen for new messages on this conversation via Socket.io
  const handleNewMessage = useCallback((msg: unknown) => {
    queryClient.setQueryData(
      getListMessagesQueryKey(conversationId),
      (old: unknown[] | undefined) => old ? [...old, msg] : [msg],
    );
    queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
  }, [conversationId, queryClient]);

  useConversationSocket(conversationId, handleNewMessage, handleTyping, currentUserName);

  // Emit typing events using the authenticated current user's name
  const emitTyping = useTypingEmit(conversationId, currentUserName);

  const sendMessageMut = useSendMessage();
  const resolveMut = useResolveConversation();
  const assignMut = useAssignConversation();

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    if (!message.trim() && attachments.length === 0) return;
    if (!canSend) {
      toast({ title: "You do not have permission to send messages", variant: "destructive" });
      return;
    }
    sendMessageMut.mutate(
      { id: conversationId, data: { body: message || "(attachment)", isNote, attachments } },
      {
        onSuccess: () => {
          setMessage("");
          setIsNote(false);
          setAttachments([]);
          queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(conversationId) });
          queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
        },
        onError: () => toast({ title: "Failed to send message", variant: "destructive" })
      }
    );
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 400_000) {
      toast({ title: "File too large (max 400KB)", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      uploadMut.mutate(
        { dataUrl, filename: file.name },
        {
          onSuccess: (res) => setAttachments((prev) => [...prev, res.url]),
          onError: () => toast({ title: "Upload failed", variant: "destructive" }),
        },
      );
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleResolve = () => {
    resolveMut.mutate({ id: conversationId }, {
      onSuccess: () => {
        toast({ title: "Conversation completed" });
        queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
        queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
      }
    });
  };

  const handleAssignToMe = () => {
    if (!currentUserId) return;
    assignMut.mutate({ id: conversationId, data: { agentId: currentUserId } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
        queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
      }
    });
  };

  if (convLoading || msgsLoading) {
    return <div className="flex-1 flex items-center justify-center border-r border-border"><Skeleton className="h-8 w-8 rounded-full" /></div>;
  }

  return (
    <div className="flex-1 flex flex-col border-r border-border min-w-[400px]">
      {/* Header */}
      <div className="h-16 px-6 border-b border-border flex items-center justify-between bg-card flex-shrink-0">
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-primary/10 text-primary">{conv?.customer?.name?.substring(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div>
            <h3 className="text-sm font-semibold">{conv?.customer?.name}</h3>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              {conv?.assignedAgent ? (
                <>Assigned to {conv.assignedAgent.name}</>
              ) : (
                <span className="text-amber-500">Unassigned</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ChatReasonPicker
            conversationId={conversationId}
            currentReasonId={(conv as { chatReasonId?: number | null } | undefined)?.chatReasonId ?? null}
          />
          {conv?.status !== "completed" && (
            <Button size="sm" variant="outline" onClick={handleResolve} disabled={resolveMut.isPending} data-testid="btn-resolve">
              <CheckCircle2 className="h-4 w-4 mr-2 text-emerald-500" />
              Resolve
            </Button>
          )}
          {!conv?.assignedAgentId && conv?.status !== "completed" && (
            <Button size="sm" variant="default" onClick={handleAssignToMe} disabled={assignMut.isPending} data-testid="btn-assign-me">
              Assign to me
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4 bg-muted/10" ref={scrollRef}>
        <div className="space-y-4 max-w-3xl mx-auto pb-4">
          {typingAgent && (
            <div className="flex justify-start" data-testid="typing-indicator">
              <div className="flex flex-col gap-1 items-start">
                <div className="px-4 py-2.5 rounded-2xl rounded-bl-sm bg-card border border-border shadow-sm flex items-center gap-2">
                  <span className="text-xs text-muted-foreground italic">{typingAgent} is typing</span>
                  <span className="flex gap-0.5 items-center">
                    <span className="w-1 h-1 rounded-full bg-muted-foreground animate-bounce [animation-delay:0ms]" />
                    <span className="w-1 h-1 rounded-full bg-muted-foreground animate-bounce [animation-delay:150ms]" />
                    <span className="w-1 h-1 rounded-full bg-muted-foreground animate-bounce [animation-delay:300ms]" />
                  </span>
                </div>
              </div>
            </div>
          )}
          {messages?.map((msg) => {
            const isMe = msg.senderType === "agent";
            const isSystem = msg.senderType === "system";
            
            if (isSystem) {
              return (
                <div key={msg.id} className="flex justify-center my-4">
                  <span className="bg-muted px-3 py-1 rounded-full text-xs text-muted-foreground">
                    {msg.body}
                  </span>
                </div>
              );
            }

            if (msg.isNote) {
              return (
                <div key={msg.id} className="flex justify-center my-4">
                  <div className="bg-amber-100 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800/50 rounded-lg px-4 py-3 max-w-lg w-full">
                    <div className="flex items-center gap-2 mb-1">
                      <Clock className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                      <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">Internal Note</span>
                      <span className="text-[10px] text-amber-700/70 dark:text-amber-400/70 ml-auto">{format(parseISO(msg.createdAt), "MMM d, h:mm a")}</span>
                    </div>
                    <p className="text-sm text-amber-900 dark:text-amber-100">{msg.body}</p>
                  </div>
                </div>
              );
            }

            return (
              <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                <div className={`flex flex-col gap-1 max-w-[75%] ${isMe ? 'items-end' : 'items-start'}`}>
                  <div 
                    className={`px-4 py-2.5 rounded-2xl ${
                      isMe 
                        ? 'bg-primary text-primary-foreground rounded-br-sm shadow-sm' 
                        : 'bg-card border border-border rounded-bl-sm shadow-sm'
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground px-1">
                    {format(parseISO(msg.createdAt), "h:mm a")}
                    {isMe && (msg.status as string) === "failed" && (
                      <span className="ml-1 font-semibold text-destructive">
                        · Not delivered (WhatsApp)
                      </span>
                    )}
                    {isMe && (msg.status as string) === "read" && " · Read"}
                    {isMe && (msg.status as string) === "delivered" && " · Delivered"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Input Area */}
      {conv?.status !== "completed" ? (
        <div className="p-4 bg-card border-t border-border">
          <div className="max-w-3xl mx-auto relative rounded-xl border border-border bg-background focus-within:ring-1 focus-within:ring-ring overflow-hidden shadow-sm">
            {isNote && (
              <div className="bg-amber-100 dark:bg-amber-900/30 px-3 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-300 border-b border-amber-200 dark:border-amber-800/50 flex items-center">
                <Clock className="h-3 w-3 mr-1.5" />
                Drafting Internal Note (Not visible to patient)
              </div>
            )}
            <Textarea
              value={message}
              onChange={(e) => { setMessage(e.target.value); emitTyping(); }}
              onKeyDown={handleKeyDown}
              placeholder={isNote ? "Type an internal note..." : "Type a message..."}
              className="min-h-[80px] border-0 focus-visible:ring-0 resize-none rounded-none text-sm p-3 bg-transparent"
              data-testid="input-chat-message"
            />
            <div className="flex items-center justify-between p-2 bg-muted/20 border-t border-border">
              <div className="flex items-center gap-1 flex-wrap">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className={`h-8 px-2 text-xs ${isNote ? 'bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900 dark:text-amber-100' : 'text-muted-foreground'}`}
                  onClick={() => setIsNote(!isNote)}
                >
                  <Clock className="h-3 w-3 mr-1.5" />
                  Note
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => fileInputRef.current?.click()} disabled={!canSend}>
                  <Paperclip className="h-4 w-4" />
                </Button>
                <input ref={fileInputRef} type="file" accept="image/*,.pdf,.txt" className="hidden" onChange={handleFileSelect} />
                {attachments.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">{attachments.length} file(s)</span>
                )}
                <ChannelButtons />
              </div>
              <Button 
                size="sm" 
                className="h-8 px-4" 
                onClick={handleSend} 
                disabled={(!message.trim() && attachments.length === 0) || sendMessageMut.isPending || !canSend}
                data-testid="btn-send-message"
              >
                {sendMessageMut.isPending ? <Skeleton className="h-4 w-4" /> : <Send className="h-4 w-4 mr-2" />}
                Send
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-4 bg-muted text-center text-sm text-muted-foreground border-t border-border">
          This conversation is completed. 
        </div>
      )}
    </div>
  );
}

function ChannelButtons() {
  const { toast } = useToast();
  const channels: { key: string; label: string; icon: React.ReactNode; color: string }[] = [
    { key: "web",       label: "Web Chat (active)", icon: <Globe className="h-4 w-4" />,                     color: "text-emerald-600" },
    { key: "whatsapp",  label: "WhatsApp",          icon: <FaWhatsapp className="h-4 w-4" />,                color: "text-[#25D366]" },
    { key: "messenger", label: "Facebook Messenger",icon: <FaFacebookMessenger className="h-4 w-4" />,       color: "text-[#0084FF]" },
    { key: "instagram", label: "Instagram DM",      icon: <FaInstagram className="h-4 w-4" />,               color: "text-[#E4405F]" },
    { key: "sms",       label: "SMS",               icon: <FaSms className="h-4 w-4" />,                     color: "text-slate-500" },
  ];
  const [active, setActive] = React.useState<string>("web");

  const handleClick = (channelKey: string, channelLabel: string) => {
    if (channelKey === "web") {
      setActive("web");
      return;
    }
    toast({
      title: `${channelLabel} not connected yet`,
      description: "We'll wire this channel up once the integration step is approved.",
    });
  };

  return (
    <div className="flex items-center gap-0.5 ml-1 pl-2 border-l border-border" data-testid="channel-buttons">
      {channels.map((c) => (
        <Button
          key={c.key}
          type="button"
          variant="ghost"
          size="icon"
          title={c.label}
          aria-label={c.label}
          onClick={() => handleClick(c.key, c.label)}
          className={`h-8 w-8 ${active === c.key ? `${c.color} bg-muted` : "text-muted-foreground hover:" + c.color}`}
          data-testid={`btn-channel-${c.key}`}
        >
          {c.icon}
        </Button>
      ))}
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
    <div className="w-80 flex-shrink-0 flex flex-col bg-sidebar overflow-hidden min-h-0">
      <Tabs defaultValue="details" className="flex-1 flex flex-col min-h-0">
        <TabsList className="w-full justify-start h-12 rounded-none border-b border-border bg-transparent px-4">
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
                    disabled={patchMut.isPending}
                  >
                    <SelectTrigger className="h-8 text-xs bg-background" data-testid="select-assignee">
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {users?.map(u => (
                        <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
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

            {/* Patient Info */}
            <div className="flex flex-col items-center text-center">
              <Avatar className="h-16 w-16 mb-3 border-2 border-border shadow-sm">
                <AvatarFallback className="text-lg bg-primary/10 text-primary">{customer?.name?.substring(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <h3 className="font-semibold text-base">{customer?.name}</h3>
              <p className="text-sm text-muted-foreground">Patient</p>
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
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Clinical Notes</h4>
                  {customer.prescriptionNotes && (
                    <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-md border border-blue-100 dark:border-blue-800/50">
                      <p className="text-xs font-semibold text-blue-800 dark:text-blue-300 mb-1">Prescription Data</p>
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
