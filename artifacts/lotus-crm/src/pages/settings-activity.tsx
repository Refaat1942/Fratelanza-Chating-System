/**
 * Settings → Activity Log (admins): who did what — sign-ins, user and
 * permission changes, assignments, takeovers, whispers and supervisor
 * monitoring. Whisper text itself is not copied into the log.
 */
import React, { useState } from "react";
import { format, parseISO } from "date-fns";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, ErrorState } from "@/components/states";
import { useAuditLogs, type AuditLogRow } from "@/lib/api-extra";

const FILTERS = [
  { v: "all", l: "Everything" },
  { v: "auth", l: "Sign-ins" },
  { v: "user", l: "User changes" },
  { v: "permissions", l: "Permission changes" },
  { v: "conversation", l: "Assignments & takeovers" },
  { v: "whisper", l: "Whispers" },
  { v: "monitor", l: "Supervisor monitoring" },
  { v: "team", l: "Teams" },
  { v: "bot", l: "Bots" },
  { v: "customers", l: "Customer import / export / merge" },
  { v: "settings", l: "Settings" },
];

const LABELS: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.login_failed": "Failed sign-in",
  "user.created": "Created user",
  "user.updated": "Updated user",
  "user.activated": "Activated user",
  "user.deactivated": "Deactivated user",
  "user.deleted": "Deleted user",
  "user.reset_link_issued": "Issued password reset link",
  "permissions.role_changed": "Changed role permissions",
  "permissions.user_changed": "Changed a user's permissions",
  "conversation.assigned": "Assigned chat",
  "conversation.bulk_assigned": "Assigned chats (bulk)",
  "conversation.takeover": "Took over chat",
  "conversation.takeover_released": "Handed chat back",
  "whisper.sent": "Sent a whisper",
  "monitor.open": "Opened an agent's chat (monitoring)",
  "settings.updated": "Changed settings",
  "templates.synced": "Synced WhatsApp templates",
  "bot.created": "Created bot",
  "bot.updated": "Updated bot",
  "bot.activated": "Switched a bot on",
  "bot.deactivated": "Switched a bot off",
  "bot.deleted": "Deleted bot",
  "customers.exported": "Exported customers",
  "customers.imported": "Imported customers",
  "customers.merged": "Merged duplicate customers",
  "team.created": "Created team",
  "team.updated": "Updated team",
  "team.members_changed": "Changed team members",
  "team.deleted": "Deleted team",
  "conversation.team_transferred": "Transferred chats to a team",
};

function describe(r: AuditLogRow): string {
  const d = (r.details ?? {}) as Record<string, unknown>;
  const target = r.entityType && r.entityId ? `${r.entityType} #${r.entityId}` : r.entityType ?? "";
  const extra: string[] = [];
  if (d["direction"]) extra.push(d["direction"] === "agent_to_supervisor" ? "agent → supervisor" : "supervisor → agent");
  if (d["roleFrom"]) extra.push(`role ${d["roleFrom"]} → ${d["roleTo"]}`);
  if (Array.isArray(d["fields"])) extra.push(`fields: ${(d["fields"] as string[]).join(", ")}`);
  if ("from" in d || "to" in d) extra.push(`from user ${d["from"] ?? "queue"} to ${d["to"] ?? "queue"}`);
  if (d["email"]) extra.push(String(d["email"]));
  if (d["role"]) extra.push(`role ${d["role"]}`);
  if (d["updated"] !== undefined) extra.push(`${d["updated"]} chat(s)`);
  return [target, ...extra].filter(Boolean).join(" · ");
}

export function ActivityLogSettings() {
  const [filter, setFilter] = useState("all");
  const [pages, setPages] = useState<(number | null)[]>([null]);
  const before = pages[pages.length - 1];
  const { data, isLoading, isError, refetch, isFetching } = useAuditLogs({ action: filter === "all" ? undefined : filter, before });

  return (
    <div className="space-y-4" data-testid="settings-activity">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={filter} onValueChange={(v) => { setFilter(v); setPages([null]); }}>
          <SelectTrigger className="w-60 h-10" aria-label="Filter activity"><SelectValue /></SelectTrigger>
          <SelectContent>{FILTERS.map((f) => <SelectItem key={f.v} value={f.v}>{f.l}</SelectItem>)}</SelectContent>
        </Select>
        {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading" />}
        <p className="text-xs text-muted-foreground ml-auto">Newest first · the log cannot be edited.</p>
      </div>

      {isError ? (
        <ErrorState title="Could not load the activity log" onRetry={() => void refetch()} />
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (data?.rows.length ?? 0) === 0 ? (
        <EmptyState title="No activity yet" hint="Actions appear here as people use the system." />
      ) : (
        <ul className="rounded-xl border border-border bg-card divide-y divide-border">
          {data!.rows.map((r) => (
            <li key={r.id} className="px-3 sm:px-4 py-2.5 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 text-sm">
              <time className="text-xs text-muted-foreground tabular-nums w-36 shrink-0">{format(parseISO(r.createdAt), "d MMM yyyy, HH:mm:ss")}</time>
              <span className="font-medium w-40 shrink-0 truncate">{r.actorName ?? (r.actorId ? `User #${r.actorId}` : "—")}</span>
              <Badge variant="outline" className={r.action.startsWith("whisper") || r.action.startsWith("monitor") || r.action.includes("takeover") ? "border-whisper/40 text-whisper" : r.action === "auth.login_failed" ? "border-destructive/40 text-destructive" : ""}>
                {LABELS[r.action] ?? r.action}
              </Badge>
              <span className="text-xs text-muted-foreground truncate">{describe(r)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex justify-between">
        <Button variant="outline" size="sm" disabled={pages.length <= 1} onClick={() => setPages((p) => p.slice(0, -1))}>Newer</Button>
        <Button variant="outline" size="sm" disabled={!data?.nextBefore} onClick={() => setPages((p) => [...p, data!.nextBefore])}>Older</Button>
      </div>
    </div>
  );
}
