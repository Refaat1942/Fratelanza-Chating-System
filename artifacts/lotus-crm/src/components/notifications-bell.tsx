import React from "react";
import { Link } from "wouter";
import { Bell, MessageSquare, Clock, AlertTriangle, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useInsights } from "@/lib/api-extra";
import { formatDistanceToNow, parseISO } from "date-fns";

interface UrgentChat {
  conversationId: number;
  customerName?: string | null;
  channel?: string | null;
  lastMessage?: string | null;
  lastMessageAt?: string | null;
  ageMinutes?: number;
}

interface InsightsShape {
  summary?: { unrepliedCount?: number; urgentCount?: number };
  unrepliedChats?: UrgentChat[];
  urgentChats?: UrgentChat[];
}

export function NotificationsBell() {
  const { data } = useInsights() as { data: InsightsShape | undefined };

  const urgent = data?.urgentChats ?? [];
  const unreplied = data?.unrepliedChats ?? [];
  const totalUnread =
    (data?.summary?.urgentCount ?? 0) + (data?.summary?.unrepliedCount ?? 0);

  // We show urgent first, then any other unreplied not already in urgent.
  const urgentIds = new Set(urgent.map((u) => u.conversationId));
  const items = [
    ...urgent.map((c) => ({ ...c, kind: "urgent" as const })),
    ...unreplied
      .filter((c) => !urgentIds.has(c.conversationId))
      .map((c) => ({ ...c, kind: "waiting" as const })),
  ].slice(0, 8);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 text-muted-foreground hover:text-foreground transition-colors"
          data-testid="btn-notifications"
          aria-label="Notifications"
        >
          <Bell className="h-4.5 w-4.5" />
          {totalUnread > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center ring-2 ring-background animate-in zoom-in-50 duration-200"
              data-testid="notifications-count"
            >
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              Notifications
            </h3>
            {totalUnread > 0 && (
              <span className="text-xs text-muted-foreground">
                {totalUnread} pending
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Conversations that need your attention right now
          </p>
        </div>

        <ScrollArea className="max-h-[420px]">
          {items.length === 0 ? (
            <div className="py-12 px-6 flex flex-col items-center text-center text-muted-foreground">
              <Inbox className="h-8 w-8 opacity-30 mb-2" />
              <p className="text-sm font-medium">You're all caught up</p>
              <p className="text-xs mt-1">No urgent or unreplied chats.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((it) => (
                <li key={`${it.kind}-${it.conversationId}`}>
                  <Link
                    href={`/chat?conv=${it.conversationId}`}
                    className="block px-4 py-3 hover:bg-muted/50 transition-colors"
                    data-testid={`notification-${it.conversationId}`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div
                        className={
                          it.kind === "urgent"
                            ? "mt-0.5 p-1.5 rounded-full bg-destructive/10 text-destructive"
                            : "mt-0.5 p-1.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        }
                      >
                        {it.kind === "urgent" ? (
                          <AlertTriangle className="h-3.5 w-3.5" />
                        ) : (
                          <Clock className="h-3.5 w-3.5" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-sm font-medium truncate">
                            {it.customerName ?? "Unknown customer"}
                          </p>
                          {it.lastMessageAt && (
                            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                              {formatDistanceToNow(parseISO(it.lastMessageAt), {
                                addSuffix: true,
                              })}
                            </span>
                          )}
                        </div>
                        {it.lastMessage && (
                          <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                            {it.lastMessage}
                          </p>
                        )}
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <span
                            className={
                              it.kind === "urgent"
                                ? "text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-destructive/10 text-destructive"
                                : "text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400"
                            }
                          >
                            {it.kind === "urgent" ? "SLA breached" : "Waiting"}
                          </span>
                          {it.channel && (
                            <span className="text-[10px] text-muted-foreground capitalize">
                              · {it.channel}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>

        <div className="px-3 py-2 border-t border-border bg-muted/20">
          <Link
            href="/insights"
            className="block text-center text-xs text-primary font-medium hover:underline py-1"
            data-testid="link-view-all-notifications"
          >
            <MessageSquare className="inline h-3 w-3 mr-1 -mt-0.5" />
            View all in AI Insights
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
