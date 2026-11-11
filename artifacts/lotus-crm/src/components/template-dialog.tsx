/**
 * Send an approved WhatsApp template into a chat — the only way to message a
 * customer first or after the 24-hour window. Shows the placeholders to fill
 * and a live preview of exactly what the customer will receive.
 */
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { FileText, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Component { type?: string; format?: string; text?: string; buttons?: { type?: string; text?: string }[] }
export interface WaTemplate { id: number; name: string; language: string; category: string | null; status: string; components: Component[] | null; usageCount: number; rejectedReason: string | null; syncedAt: string }

export function useWaTemplates(all = false) {
  return useQuery({
    queryKey: ["/api/whatsapp/templates", all],
    queryFn: () => customFetch<{ configured: boolean; templates: WaTemplate[] }>(`/api/whatsapp/templates${all ? "?all=1" : ""}`),
    staleTime: 60_000,
  });
}

function holes(text?: string): string[] {
  const out: string[] = [];
  for (const m of (text ?? "").matchAll(/\{\{\s*(\w+)\s*\}\}/g)) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out;
}
function fill(text: string, v: Record<string, string>) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => v[k]?.trim() || m);
}

export function TemplateDialog({
  conversationId, customerName, onClose, onSent,
}: { conversationId: number; customerName?: string | null; onClose: () => void; onSent: (msg: unknown) => void }) {
  const { data, isLoading } = useWaTemplates();
  const [id, setId] = useState<string>("");
  const [header, setHeader] = useState<Record<string, string>>({});
  const [body, setBody] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tpl = data?.templates.find((t) => String(t.id) === id);
  const comps = tpl?.components ?? [];
  const h = comps.find((c) => c.type === "HEADER");
  const b = comps.find((c) => c.type === "BODY");
  const f = comps.find((c) => c.type === "FOOTER");
  const btns = comps.find((c) => c.type === "BUTTONS");
  const hHoles = h?.format === "TEXT" ? holes(h.text) : [];
  const bHoles = holes(b?.text);

  const choose = (v: string) => {
    setId(v);
    setError(null);
    // Pre-fill the common case: first body placeholder = the customer's name.
    const t = data?.templates.find((x) => String(x.id) === v);
    const first = holes(t?.components?.find((c) => c.type === "BODY")?.text)[0];
    setHeader({});
    setBody(first && customerName && /\p{L}/u.test(customerName) ? { [first]: customerName.split(/\s+/)[0]! } : {});
  };

  const ready = !!tpl && [...hHoles.map((k) => header[k]), ...bHoles.map((k) => body[k])].every((v) => v && v.trim());
  const preview = useMemo(() => ({
    header: h?.format === "TEXT" && h.text ? fill(h.text, header) : h?.format ? `[${h.format.toLowerCase()}]` : null,
    body: b?.text ? fill(b.text, body) : "",
  }), [h, b, header, body]);

  const send = async () => {
    if (!tpl) return;
    setBusy(true);
    setError(null);
    try {
      const msg = await customFetch<{ deliveryError?: string }>(`/api/conversations/${conversationId}/template`, {
        method: "POST",
        body: JSON.stringify({ templateId: tpl.id, params: { header, body } }),
      });
      onSent(msg);
      if (msg.deliveryError) setError(msg.deliveryError); else onClose();
    } catch (e) {
      setError((e as { data?: { error?: string } }).data?.error ?? "Could not send the template");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Send a WhatsApp template</DialogTitle>
          <DialogDescription>Approved templates can be sent at any time — including more than 24 hours after the customer's last message.</DialogDescription>
        </DialogHeader>
        {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : !data?.templates.length ? (
          <p className="text-sm text-muted-foreground">
            {data?.configured ? "No approved templates yet. An admin can sync them in Settings → WhatsApp Templates." : "Templates are not set up yet (an admin needs to add WHATSAPP_BUSINESS_ACCOUNT_ID on the server and sync)."}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Template</Label>
              <Select value={id} onValueChange={choose}>
                <SelectTrigger className="h-11" data-testid="select-template"><SelectValue placeholder="Choose a template" /></SelectTrigger>
                <SelectContent>
                  {data.templates.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name} · {t.language}{t.category ? ` · ${t.category.toLowerCase()}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {tpl && h?.format && h.format !== "TEXT" && (
              <p className="text-xs text-warning">This template has a {h.format.toLowerCase()} header, which can't be sent from the inbox yet.</p>
            )}
            {hHoles.map((k) => (
              <div key={`h${k}`} className="space-y-1">
                <Label htmlFor={`th-${k}`}>Header {`{{${k}}}`}</Label>
                <Input id={`th-${k}`} value={header[k] ?? ""} onChange={(e) => setHeader({ ...header, [k]: e.target.value })} className="h-10" />
              </div>
            ))}
            {bHoles.map((k) => (
              <div key={`b${k}`} className="space-y-1">
                <Label htmlFor={`tb-${k}`}>{`{{${k}}}`}</Label>
                <Input id={`tb-${k}`} value={body[k] ?? ""} onChange={(e) => setBody({ ...body, [k]: e.target.value })} className="h-10" dir="auto" data-testid={`template-param-${k}`} />
              </div>
            ))}
            {tpl && (
              <div className="rounded-lg bg-bubble-out text-bubble-out-foreground px-3 py-2 text-sm whitespace-pre-wrap bidi" dir="auto" data-testid="template-preview">
                {preview.header && <p className="font-semibold">{preview.header}</p>}
                <p>{preview.body}</p>
                {f?.text && <p className="text-xs opacity-80 mt-1">{f.text}</p>}
                {btns?.buttons?.length ? <p className="text-xs mt-1 opacity-90">{btns.buttons.map((x) => `[${x.text}]`).join(" ")}</p> : null}
              </div>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={send} disabled={!ready || busy || (h?.format !== undefined && h.format !== "TEXT")} data-testid="btn-send-template">
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />} Send template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
