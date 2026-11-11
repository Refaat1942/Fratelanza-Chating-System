/**
 * Settings → Channels: status of every connected channel (WhatsApp, Messenger,
 * Instagram). Read-only: "Test connection" only reads the account from Meta.
 */
import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, parseISO } from "date-fns";
import { CheckCircle2, Circle, Copy, Loader2, PlugZap, XCircle } from "lucide-react";
import { FaFacebookMessenger, FaInstagram, FaWhatsapp } from "react-icons/fa";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ErrorState } from "@/components/states";

interface ChannelStatus {
  key: "whatsapp" | "messenger" | "instagram";
  name: string;
  webhookPath: string;
  config: Record<string, boolean | string>;
  ready: boolean;
  lastWebhookAt: string | null;
  events: { customerMessages: number; echoes: number; receipts: number };
  stats: { conversations: number; active: number; last_activity: string | null } | null;
  connection: { ok: boolean; account?: string; id?: string; error?: string } | null;
}

const ICON = { whatsapp: FaWhatsapp, messenger: FaFacebookMessenger, instagram: FaInstagram };
const COLOR = { whatsapp: "text-[#25D366]", messenger: "text-[#0084FF]", instagram: "text-[#E1306C]" };

const ENV_HELP: Record<ChannelStatus["key"], { label: string; key: string; env: string }[]> = {
  whatsapp: [
    { label: "Access token", key: "accessToken", env: "WHATSAPP_ACCESS_TOKEN" },
    { label: "Phone number ID", key: "phoneNumberId", env: "WHATSAPP_PHONE_NUMBER_ID" },
    { label: "App secret", key: "appSecret", env: "WHATSAPP_APP_SECRET" },
    { label: "Verify token", key: "verifyToken", env: "WHATSAPP_VERIFY_TOKEN" },
    { label: "Business account ID (templates)", key: "businessAccountId", env: "WHATSAPP_BUSINESS_ACCOUNT_ID" },
  ],
  messenger: [
    { label: "Page access token", key: "accessToken", env: "MESSENGER_PAGE_ACCESS_TOKEN" },
    { label: "App secret", key: "appSecret", env: "META_APP_SECRET (or WHATSAPP_APP_SECRET)" },
    { label: "Verify token", key: "verifyToken", env: "META_VERIFY_TOKEN (or WHATSAPP_VERIFY_TOKEN)" },
  ],
  instagram: [
    { label: "Access token", key: "accessToken", env: "INSTAGRAM_ACCESS_TOKEN" },
    { label: "App secret", key: "appSecret", env: "META_APP_SECRET (or WHATSAPP_APP_SECRET)" },
    { label: "Verify token", key: "verifyToken", env: "META_VERIFY_TOKEN (or WHATSAPP_VERIFY_TOKEN)" },
  ],
};

const FIELDS: Record<ChannelStatus["key"], string> = {
  whatsapp: "messages, smb_message_echoes, smb_app_state_sync, history",
  messenger: "messages, messaging_postbacks, message_echoes, message_deliveries, message_reads",
  instagram: "messages, messaging_postbacks, message_reactions, messaging_seen",
};

function when(iso?: string | null) {
  return iso ? formatDistanceToNow(parseISO(iso), { addSuffix: true }) : "never";
}

export function ChannelsSettings() {
  const { toast } = useToast();
  const [check, setCheck] = useState(false);
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["/api/channels/status", check],
    queryFn: () => customFetch<{ outboundEnabled: boolean; channels: ChannelStatus[] }>(`/api/channels/status${check ? "?check=1" : ""}`),
  });

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => toast({ title: "Copied" }));
  };

  if (isError) return <ErrorState title="Could not load channel status" onRetry={() => void refetch()} />;
  if (isLoading || !data) return <Skeleton className="h-96 w-full" />;
  const origin = window.location.origin;

  return (
    <div className="space-y-5" data-testid="settings-channels">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground flex-1 min-w-[240px]">
          Every channel lands in the same inbox. Credentials live in <code className="px-1 rounded bg-muted">deploy/.env</code> on the server — they are never shown here.
          {!data.outboundEnabled && <b className="text-warning"> Sending to customers is currently turned off.</b>}
        </p>
        <Button variant="outline" onClick={() => { setCheck(true); void refetch(); }} disabled={isFetching} data-testid="btn-test-connections">
          {isFetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlugZap className="h-4 w-4 mr-2" />}
          Test connections
        </Button>
      </div>

      {data.channels.map((c) => {
        const Icon = ICON[c.key];
        const url = origin + c.webhookPath;
        return (
          <section key={c.key} className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-4" data-testid={`channel-${c.key}`}>
            <div className="flex flex-wrap items-center gap-3">
              <Icon className={`h-6 w-6 ${COLOR[c.key]}`} aria-hidden />
              <h4 className="font-semibold text-base">{c.name}</h4>
              {c.ready ? (
                <Badge variant="outline" className="border-success/40 text-success bg-success/10">Configured</Badge>
              ) : (
                <Badge variant="outline" className="border-warning/40 text-warning bg-warning/10">Not connected yet</Badge>
              )}
              {c.connection && (c.connection.ok ? (
                <Badge variant="outline" className="border-success/40 text-success">Connected{c.connection.account ? ` · ${c.connection.account}` : ""}</Badge>
              ) : (
                <Badge variant="outline" className="border-destructive/40 text-destructive">Connection failed</Badge>
              ))}
            </div>
            {c.connection && !c.connection.ok && (
              <p className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2" role="alert">{c.connection.error}</p>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Server settings</p>
                <ul className="space-y-1">
                  {ENV_HELP[c.key].map((f) => {
                    const set = !!c.config[f.key];
                    return (
                      <li key={f.key} className="flex items-start gap-2 text-sm">
                        {set ? <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" /> : f.key === "businessAccountId" ? <Circle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" /> : <XCircle className="h-4 w-4 text-warning mt-0.5 shrink-0" />}
                        <span>{f.label} <code className="text-[11px] text-muted-foreground">{f.env}</code></span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Activity</p>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Last webhook</dt><dd>{when(c.lastWebhookAt)}</dd>
                  <dt className="text-muted-foreground">Customer messages</dt><dd className="tabular-nums">{c.events.customerMessages}</dd>
                  <dt className="text-muted-foreground">Sent from Meta's apps</dt><dd className="tabular-nums">{c.events.echoes}</dd>
                  <dt className="text-muted-foreground">Receipts</dt><dd className="tabular-nums">{c.events.receipts}</dd>
                  <dt className="text-muted-foreground">Conversations</dt><dd className="tabular-nums">{c.stats?.conversations ?? 0} ({c.stats?.active ?? 0} active)</dd>
                </dl>
              </div>
            </div>

            <div className="rounded-lg bg-muted/40 border border-border px-3 py-2 text-xs space-y-1">
              <p className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold">Callback URL:</span>
                <code className="break-all">{url}</code>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copy(url)} aria-label="Copy callback URL"><Copy className="h-3 w-3" /></Button>
              </p>
              <p><span className="font-semibold">Webhook fields to subscribe:</span> {FIELDS[c.key]}</p>
              {c.key !== "whatsapp" && (
                <p className="text-muted-foreground">
                  Uses the same Meta app as WhatsApp. Customers are matched by their {c.key === "messenger" ? "Page-scoped ID (PSID)" : "Instagram-scoped ID"}; replies are allowed within 24 hours of the customer's last message.
                </p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
