import React from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { CheckCircle2, XCircle, RefreshCw, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSystemStatus } from "@/lib/api-extra";
import { useQueryClient } from "@tanstack/react-query";

const KINDS: { key: string; label: string; ifMissing: string }[] = [
  { key: "customer_message", label: "Customer messages", ifMissing: "No customer message received since the server started." },
  { key: "status_update", label: "Delivery / read receipts", ifMissing: "No receipts yet — they arrive after you send a reply." },
  {
    key: "phone_app_reply",
    label: "Replies you sent from the phone app",
    ifMissing:
      "Meta has not sent any. This only works when your number is in Coexistence mode (WhatsApp Business app + Cloud API on the same number) AND “smb_message_echoes” is ticked in Meta → WhatsApp → Configuration → Webhook fields.",
  },
  { key: "history_message", label: "Imported chat history", ifMissing: "History is sent once, only during Coexistence onboarding (field “history”)." },
  { key: "contact_sync", label: "Contact names from the phone", ifMissing: "Needs Coexistence and the “smb_app_state_sync” webhook field." },
];

function when(iso?: string) {
  return iso ? formatDistanceToNow(parseISO(iso), { addSuffix: true }) : "never";
}

/** Admin diagnostics: is sending on, and which webhook events does Meta actually deliver? */
export function WhatsAppSettings() {
  const qc = useQueryClient();
  const { data, isLoading, isFetching } = useSystemStatus();
  React.useEffect(() => {
    const t = setInterval(() => void qc.invalidateQueries({ queryKey: ["/api/system"] }), 15_000);
    return () => clearInterval(t);
  }, [qc]);

  if (isLoading || !data) return <Skeleton className="h-64 w-full max-w-3xl" />;
  const ev = data.webhooks?.events ?? {};
  const fields = Object.entries(ev).filter(([k]) => k.startsWith("field:"));

  return (
    <div className="max-w-3xl space-y-5">
      <section className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-3" data-testid="wa-sending">
        <h4 className="font-semibold">Sending to customers</h4>
        <div className="flex items-start gap-3">
          {data.outboundEnabled && data.sendingConfigured ? (
            <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
          ) : (
            <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          )}
          <div className="text-sm">
            {!data.outboundEnabled ? (
              <p><b>Off.</b> The server has <code className="px-1 rounded bg-muted">WHATSAPP_SENDING_ENABLED=false</code> — replies are saved as internal notes. Remove that line (or set it to true) in <code className="px-1 rounded bg-muted">deploy/.env</code> and restart to send again.</p>
            ) : !data.sendingConfigured ? (
              <p><b>Not configured.</b> <code className="px-1 rounded bg-muted">WHATSAPP_ACCESS_TOKEN</code> or <code className="px-1 rounded bg-muted">WHATSAPP_PHONE_NUMBER_ID</code> is missing in <code className="px-1 rounded bg-muted">deploy/.env</code>.</p>
            ) : (
              <p><b>On.</b> Replies typed in the inbox are sent through the WhatsApp Cloud API. WhatsApp only accepts normal replies within 24 hours of the customer's last message.</p>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-3" data-testid="wa-events">
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-semibold flex items-center gap-2"><Smartphone className="h-4 w-4" /> What Meta is sending us</h4>
          <Button variant="ghost" size="sm" onClick={() => void qc.invalidateQueries({ queryKey: ["/api/system"] })} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Counted since the server last started ({when(data.webhooks?.since)}). Send yourself a test from the phone, then press Refresh.</p>
        <ul className="divide-y divide-border">
          {KINDS.map((k) => {
            const s = ev[k.key];
            return (
              <li key={k.key} className="py-3 flex items-start gap-3" data-testid={`wa-kind-${k.key}`}>
                {s ? <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" /> : <XCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium">{k.label}</p>
                    <p className="text-xs tabular-nums text-muted-foreground">{s ? `${s.count} · last ${when(s.lastAt)}` : "none"}</p>
                  </div>
                  {!s && <p className="text-xs text-muted-foreground mt-0.5">{k.ifMissing}</p>}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">
          Webhook fields received: {fields.length ? fields.map(([k, v]) => `${k.slice(6)} (${v.count})`).join(", ") : "none yet"}.
        </p>
      </section>
      <p className="text-xs text-muted-foreground">Lists and labels made in the WhatsApp Business phone app are not available through any Meta API, so they cannot appear here. Use Inbox → Select → Add to list.</p>
    </div>
  );
}
