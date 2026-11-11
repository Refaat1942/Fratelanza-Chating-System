/**
 * Live Monitor (supervisors/admins): every active chat with its agent, wait
 * time and duration, plus the Hanging / Last-client-message / Unassigned /
 * Long-waiting / SLA-risk queues. All numbers come from /api/monitoring.
 */
import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, Clock, Eye, Hourglass, Inbox, Loader2, MessageCircleQuestion, Radar, ShieldCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getSharedSocket } from "@/hooks/use-socket";
import { EmptyState, ErrorState } from "@/components/states";
import {
  useBulkConversations,
  useMonitoring,
  useMyPermissions,
  useTakeover,
  type MonitoringRow,
  type MonitoringView,
} from "@/lib/api-extra";
import { roleLabel } from "@/lib/types";
import { cn } from "@/lib/utils";

const VIEWS: { key: MonitoringView; label: string; hint: string; icon: React.ElementType }[] = [
  { key: "active", label: "Active chats", hint: "Open or pending chats that an agent is handling.", icon: Radar },
  { key: "last_client", label: "Last client message", hint: "The customer wrote last and no one has answered yet.", icon: MessageCircleQuestion },
  { key: "sla", label: "SLA risk", hint: "Customer waiting at least half the SLA time (red = breached).", icon: AlertTriangle },
  { key: "hanging", label: "Hanging", hint: "Not completed and no activity for longer than the hanging threshold.", icon: Hourglass },
  { key: "unassigned", label: "Unassigned", hint: "Chats waiting in the queue for an agent.", icon: UserX },
  { key: "long_waiting", label: "Long waiting", hint: "Unassigned for longer than the SLA time.", icon: Clock },
];

const CHANNELS = [
  { v: "all", l: "All channels" },
  { v: "whatsapp", l: "WhatsApp" },
  { v: "messenger", l: "Messenger" },
  { v: "instagram", l: "Instagram" },
  { v: "sms", l: "SMS" },
  { v: "web", l: "Web chat" },
];

function dur(min: number | null | undefined): string {
  if (min === null || min === undefined) return "—";
  if (min < 1) return "<1m";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h ${min % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const STATUS_DOT: Record<string, string> = { available: "bg-success", busy: "bg-warning", offline: "bg-muted-foreground/40" };

export default function MonitoringPage() {
  const [view, setView] = useState<MonitoringView>("active");
  const [agentId, setAgentId] = useState<number | undefined>();
  const [channel, setChannel] = useState("all");
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: perms } = useMyPermissions();
  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } = useMonitoring(view, {
    agentId,
    channel: channel === "all" ? undefined : channel,
  });
  const takeover = useTakeover();
  const bulk = useBulkConversations();

  // Push-refresh whenever any chat changes (the 10s poll is the fallback).
  useEffect(() => {
    const s = getSharedSocket();
    const kick = () => void qc.invalidateQueries({ queryKey: ["/api/monitoring"] });
    s.on("conversation_updated", kick);
    s.on("conversation_assigned", kick);
    s.on("conversation_queued", kick);
    return () => {
      s.off("conversation_updated", kick);
      s.off("conversation_assigned", kick);
      s.off("conversation_queued", kick);
    };
  }, [qc]);

  const agents = data?.agents ?? [];
  const assignable = useMemo(() => agents.filter((a) => a.role === "agent" || a.role === "supervisor"), [agents]);
  const current = VIEWS.find((v) => v.key === view)!;

  const open = (id: number) => setLocation(`/chat?conv=${id}`);
  const doTakeover = (row: MonitoringRow) =>
    takeover.mutate(row.id, {
      onSuccess: () => { toast({ title: "You took over the chat" }); open(row.id); },
      onError: (e) => toast({ title: "Could not take over", description: (e as { data?: { error?: string } }).data?.error, variant: "destructive" }),
    });
  const assign = (row: MonitoringRow, to: string) =>
    bulk.mutate(
      { ids: [row.id], action: "assign", value: to === "queue" ? null : Number(to) },
      {
        onSuccess: () => { toast({ title: to === "queue" ? "Returned to the queue" : "Chat assigned" }); void refetch(); },
        onError: (e) => toast({ title: "Could not assign", description: (e as { data?: { error?: string } }).data?.error, variant: "destructive" }),
      },
    );

  return (
    <div className="flex-1 overflow-y-auto bg-background p-4 sm:p-6 lg:p-8 space-y-5" data-testid="page-monitoring">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Radar className="h-7 w-7 text-primary" aria-hidden /> Live Monitor
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Watch live chats, guide agents privately with Whisper, or take over. SLA {data?.thresholds.slaMinutes ?? "…"} min · hanging after {data?.thresholds.hangingHours ?? "…"} h (Settings → Chat Distribution / Branding).
          </p>
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">
          {isFetching ? <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Refreshing…</span>
            : dataUpdatedAt ? `Updated ${format(new Date(dataUpdatedAt), "h:mm:ss a")}` : null}
        </p>
      </div>

      {/* Agents */}
      <section aria-label="Agents" className="flex gap-2 overflow-x-auto pb-1">
        {isLoading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-44 shrink-0" />)}
        {agents.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAgentId((cur) => (cur === a.id ? undefined : a.id))}
            className={cn(
              "shrink-0 w-48 text-left rounded-xl border bg-card px-3 py-2 transition-colors hover:border-primary/50",
              agentId === a.id && "border-primary ring-1 ring-primary",
            )}
            aria-pressed={agentId === a.id}
            data-testid={`agent-card-${a.id}`}
          >
            <p className="text-sm font-semibold truncate flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-full shrink-0", STATUS_DOT[a.status] ?? "bg-muted")} aria-label={a.status} />
              {a.name}
            </p>
            <p className="text-[11px] text-muted-foreground">{roleLabel(a.role)} · {a.status}</p>
            <p className="text-xs mt-0.5 tabular-nums">
              <b>{a.open_chats}</b> open · <span className={cn(a.awaiting_reply > 0 && "text-warning font-semibold")}>{a.awaiting_reply} awaiting reply</span>
            </p>
          </button>
        ))}
      </section>

      {/* Views */}
      <div role="tablist" aria-label="Queues" className="flex flex-wrap gap-2">
        {VIEWS.map((v) => {
          const n = data?.counts?.[v.key];
          const Icon = v.icon;
          return (
            <button
              key={v.key}
              role="tab"
              type="button"
              aria-selected={view === v.key}
              onClick={() => setView(v.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm",
                view === v.key ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted",
              )}
              data-testid={`view-${v.key}`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {v.label}
              {n !== undefined && (
                <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", view === v.key ? "bg-primary-foreground/20" : "bg-muted")}>{n}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground flex-1 min-w-[200px]">{current.hint}</p>
        <Select value={channel} onValueChange={setChannel}>
          <SelectTrigger className="w-40 h-9" aria-label="Channel"><SelectValue /></SelectTrigger>
          <SelectContent>{CHANNELS.map((c) => <SelectItem key={c.v} value={c.v}>{c.l}</SelectItem>)}</SelectContent>
        </Select>
        {agentId && (
          <Button variant="ghost" size="sm" onClick={() => setAgentId(undefined)}>Clear agent filter</Button>
        )}
      </div>

      {isError ? (
        <ErrorState title="Could not load the monitor" onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : (data?.conversations.length ?? 0) === 0 ? (
        <EmptyState title="Nothing here right now" hint="This queue is empty for the selected filters." />
      ) : (
        <ul className="rounded-xl border border-border bg-card divide-y divide-border" data-testid="monitor-list">
          {data!.conversations.map((c) => (
            <li key={c.id} className="p-3 sm:px-4 flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-4" data-testid={`monitor-row-${c.id}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">
                  {c.customer_name}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{c.customer_phone} · {c.channel}</span>
                </p>
                <p className="text-xs text-muted-foreground truncate bidi">
                  {c.last_sender_type === "customer" ? "Customer: " : c.last_sender_type === "agent" ? "Agent: " : ""}
                  {c.last_message ?? "—"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline" className="capitalize">{c.status}</Badge>
                {c.agent_name ? (
                  <span className="inline-flex items-center gap-1">
                    <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[c.agent_status ?? ""] ?? "bg-muted")} aria-hidden />
                    {c.agent_name}
                  </span>
                ) : (
                  <span className="text-warning font-medium">Unassigned</span>
                )}
                {c.takeover_from_agent_id && (
                  <Badge className="bg-whisper/15 text-whisper border-whisper/30" variant="outline">Taken over from {c.takeover_from_name}</Badge>
                )}
                <span className={cn("tabular-nums", c.sla_breached ? "text-destructive font-semibold" : c.waiting_minutes !== null ? "text-warning" : "text-muted-foreground")} title="Customer waiting for a reply">
                  <Clock className="inline h-3 w-3 mr-0.5" aria-hidden />
                  {c.waiting_minutes !== null ? `waiting ${dur(c.waiting_minutes)}` : "answered"}
                </span>
                <span className="text-muted-foreground tabular-nums" title="Time since the chat started">open {dur(c.age_minutes)}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button size="sm" variant="outline" className="h-8" onClick={() => open(c.id)} data-testid={`btn-open-${c.id}`}>
                  <Eye className="h-3.5 w-3.5 mr-1" /> Open
                </Button>
                {perms?.canTakeover && c.assigned_agent_id && !c.takeover_from_agent_id && (
                  <Button size="sm" variant="outline" className="h-8" onClick={() => doTakeover(c)} disabled={takeover.isPending}>
                    <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Take over
                  </Button>
                )}
                <Select onValueChange={(v) => assign(c, v)}>
                  <SelectTrigger className="h-8 w-[130px] text-xs" aria-label="Assign to"><SelectValue placeholder="Assign to…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="queue"><Inbox className="inline h-3 w-3 mr-1" />Back to queue</SelectItem>
                    {assignable.filter((a) => a.id !== c.assigned_agent_id).map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.name} ({a.open_chats})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
