/**
 * Settings → WhatsApp Templates: read-only sync from Meta, status of each
 * template, and template analytics (sent / delivered / read / replied).
 */
import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Loader2, RefreshCw } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { EmptyState } from "@/components/states";
import { useWaTemplates } from "@/components/template-dialog";

interface Row { id: number; name: string; language: string; category: string | null; status: string; sent: number; delivered: number; read: number; failed: number; replied: number }

const STATUS_TONE: Record<string, string> = {
  APPROVED: "border-success/40 text-success bg-success/10",
  PENDING: "border-warning/40 text-warning bg-warning/10",
  REJECTED: "border-destructive/40 text-destructive bg-destructive/10",
  PAUSED: "border-warning/40 text-warning",
  DISABLED: "border-destructive/40 text-destructive",
};

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

export function TemplatesSettings() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);
  const { data, isLoading } = useWaTemplates(true);
  const { data: an } = useQuery({
    queryKey: ["/api/whatsapp/templates/analytics"],
    queryFn: () => customFetch<{ days: number; rows: Row[] }>("/api/whatsapp/templates/analytics?days=30"),
  });

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await customFetch<{ synced: number }>("/api/whatsapp/templates/sync", { method: "POST", body: "{}" });
      toast({ title: `Synced ${r.synced} template${r.synced === 1 ? "" : "s"} from Meta` });
      void qc.invalidateQueries({ queryKey: ["/api/whatsapp/templates"] });
      void qc.invalidateQueries({ queryKey: ["/api/whatsapp/templates/analytics"] });
    } catch (e) {
      toast({ title: "Sync failed", description: (e as { data?: { error?: string } }).data?.error, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const stats = new Map((an?.rows ?? []).map((r) => [r.id, r]));

  return (
    <div className="space-y-4" data-testid="settings-templates">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground flex-1 min-w-[240px]">
          Templates are created and approved in Meta's WhatsApp Manager; this page only reads them. Approved ones can be sent from any WhatsApp chat (“Template” button), even after the 24-hour window.
          {data && !data.configured && <b className="text-warning"> Add WHATSAPP_BUSINESS_ACCOUNT_ID to deploy/.env to enable syncing.</b>}
        </p>
        <Button onClick={sync} disabled={syncing || (data && !data.configured)} data-testid="btn-sync-templates">
          {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />} Sync from Meta
        </Button>
      </div>
      {isLoading ? <Skeleton className="h-40 w-full" /> : !data?.templates.length ? (
        <EmptyState title="No templates synced yet" hint="Press “Sync from Meta” to load your templates." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b border-border">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Template</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium text-right">Sent (30d)</th>
                <th className="px-3 py-2 font-medium text-right">Delivered</th>
                <th className="px-3 py-2 font-medium text-right">Read</th>
                <th className="px-3 py-2 font-medium text-right">Replied ≤24h</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.templates.map((t) => {
                const s = stats.get(t.id);
                const body = t.components?.find((c) => c.type === "BODY")?.text;
                return (
                  <tr key={t.id} className="align-top">
                    <td className="px-3 py-2 max-w-md">
                      <p className="font-medium">{t.name} <span className="text-xs text-muted-foreground">· {t.language}{t.category ? ` · ${t.category.toLowerCase()}` : ""}</span></p>
                      {body && <p className="text-xs text-muted-foreground line-clamp-2 bidi" dir="auto">{body}</p>}
                      {t.rejectedReason && <p className="text-xs text-destructive">Reason: {t.rejectedReason}</p>}
                    </td>
                    <td className="px-3 py-2"><Badge variant="outline" className={STATUS_TONE[t.status] ?? ""}>{t.status.toLowerCase()}</Badge></td>
                    <td className="px-3 py-2 text-right tabular-nums">{s?.sent ?? 0}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(s?.delivered ?? 0, s?.sent ?? 0)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(s?.read ?? 0, s?.sent ?? 0)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(s?.replied ?? 0, s?.sent ?? 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[11px] text-muted-foreground border-t border-border">
            Last synced {data.templates[0] ? formatDistanceToNow(parseISO(data.templates[0].syncedAt), { addSuffix: true }) : "never"}. Status changes also arrive live if the webhook field “message_template_status_update” is subscribed.
          </p>
        </div>
      )}
    </div>
  );
}
