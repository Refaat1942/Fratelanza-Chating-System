/**
 * CRM extras used by the Customers page: import/export, duplicate finder and
 * merge, custom fields + email editor, activity timeline.
 */
import React, { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { format, parseISO } from "date-fns";
import {
  Activity, CheckCircle2, Copy, Download, FileUp, GitMerge, Loader2, Mail, MessageSquare, Save, ShieldCheck, StickyNote, UserCheck, UserPlus,
} from "lucide-react";
import { FaFacebookMessenger, FaInstagram } from "react-icons/fa";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { EmptyState } from "@/components/states";

export interface CustomerField { id: number; key: string; label: string; type: "text" | "number" | "date" | "select"; options: string[]; sortOrder: number }

export function useCustomerFields() {
  return useQuery({ queryKey: ["/api/customer-fields"], queryFn: () => customFetch<CustomerField[]>("/api/customer-fields"), staleTime: 60_000 });
}

const errMsg = (e: unknown, f: string) => (e as { data?: { error?: string } })?.data?.error ?? f;

// ── Export ──────────────────────────────────────────────────────────────────

export function ExportButton() {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      // Authenticated download: fetch with the token, then save the blob.
      const res = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/customers/export.csv`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("lotus_token") ?? ""}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `customers-${format(new Date(), "yyyy-MM-dd")}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5_000);
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="outline" onClick={run} disabled={busy} data-testid="btn-export-customers">
      {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />} Export
    </Button>
  );
}

// ── Import ──────────────────────────────────────────────────────────────────

export function ImportDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [mode, setMode] = useState<"skip" | "update">("skip");
  const fileRef = useRef<HTMLInputElement>(null);
  const mut = useMutation({
    mutationFn: () => customFetch<{ created: number; updated: number; skipped: number; errors: { row: number; error: string }[]; totalErrors: number }>(
      "/api/customers/import", { method: "POST", body: JSON.stringify({ csv, mode }) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["/api/customers"] }),
  });
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 1_800_000) { setCsv(""); alert("File too large (max 1.8 MB — split it into smaller files)"); return; }
    void f.text().then(setCsv);
    e.target.value = "";
  };
  const r = mut.data;
  return (
    <>
      <Button variant="outline" onClick={() => { setOpen(true); mut.reset(); }} data-testid="btn-import-customers"><FileUp className="h-4 w-4 mr-1.5" /> Import</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[92dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import customers (CSV)</DialogTitle>
            <DialogDescription>
              Columns: <code>name, phone, email, branch, address, tags, notes</code> plus any custom field key. Tags separated by “;”. A phone column is required; up to 5,000 rows.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><FileUp className="h-4 w-4 mr-1.5" /> Choose .csv file</Button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
            <Textarea rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"name,phone,email,tags\nMona Ali,01001234567,mona@example.com,VIP;Pharmacy"} className="font-mono text-xs" aria-label="CSV content" data-testid="import-csv" />
            <div className="space-y-1.5">
              <Label>When a phone number already exists</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as "skip" | "update")}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="skip">Skip that row (safest)</SelectItem>
                  <SelectItem value="update">Fill in the details from the file (never blanks existing data)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {mut.isError && <p role="alert" className="text-sm text-destructive">{errMsg(mut.error, "Import failed")}</p>}
            {r && (
              <div className="rounded-md border border-border p-3 text-sm space-y-1" role="status" data-testid="import-result">
                <p className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-success" /> {r.created} created · {r.updated} updated · {r.skipped} skipped</p>
                {r.totalErrors > 0 && (
                  <p className="text-xs text-warning">{r.totalErrors} row(s) not imported: {r.errors.slice(0, 5).map((e) => `row ${e.row} (${e.error})`).join(", ")}{r.totalErrors > 5 ? "…" : ""}</p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            <Button onClick={() => mut.mutate()} disabled={!csv.trim() || mut.isPending} data-testid="btn-run-import">{mut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Import</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Duplicates & merge ──────────────────────────────────────────────────────

interface DupGroup { reason: "phone" | "email"; key: string; customers: { id: number; name: string; phone: string; email: string | null; createdAt: string; conversations: number }[] }

export function DuplicatesDialog() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/customers/duplicates"],
    queryFn: () => customFetch<DupGroup[]>("/api/customers/duplicates"),
    enabled: open,
  });
  const merge = useMutation({
    mutationFn: ({ target, source }: { target: number; source: number }) =>
      customFetch(`/api/customers/${target}/merge`, { method: "POST", body: JSON.stringify({ sourceId: source }) }),
    onSuccess: () => {
      toast({ title: "Customers merged", description: "Conversations, tags and details were combined." });
      void qc.invalidateQueries({ queryKey: ["/api/customers"] });
      void refetch();
    },
    onError: (e) => toast({ title: errMsg(e, "Merge failed"), variant: "destructive" }),
  });
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="btn-duplicates"><Copy className="h-4 w-4 mr-1.5" /> Duplicates</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[92dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Possible duplicate customers</DialogTitle>
            <DialogDescription>Same phone number (last 10 digits, so 0100… and +20 100… match) or same email. Merging keeps the first customer and moves everything from the other into it.</DialogDescription>
          </DialogHeader>
          {isLoading ? <Skeleton className="h-32 w-full" /> : !data?.length ? (
            <EmptyState title="No duplicates found" hint="Every phone number and email belongs to one customer." />
          ) : (
            <ul className="space-y-3">
              {data.map((g) => {
                const [keep, ...others] = g.customers;
                return (
                  <li key={`${g.reason}:${g.key}`} className="rounded-lg border border-border p-3 space-y-2" data-testid="dup-group">
                    <p className="text-xs text-muted-foreground">Same {g.reason}: <b>{g.key}</b></p>
                    <p className="text-sm"><UserCheck className="inline h-4 w-4 mr-1 text-success" /><b>{keep!.name}</b> · {keep!.phone} · {keep!.conversations} chat(s) <span className="text-xs text-muted-foreground">(kept)</span></p>
                    {others.map((o) => (
                      <div key={o.id} className="flex flex-wrap items-center gap-2 text-sm pl-5">
                        <span className="flex-1 min-w-[180px]">{o.name} · {o.phone}{o.email ? ` · ${o.email}` : ""} · {o.conversations} chat(s)</span>
                        <Button size="sm" variant="outline" disabled={merge.isPending} onClick={() => merge.mutate({ target: keep!.id, source: o.id })} data-testid={`btn-merge-${o.id}`}>
                          <GitMerge className="h-3.5 w-3.5 mr-1" /> Merge into {keep!.name.split(" ")[0]}
                        </Button>
                      </div>
                    ))}
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Email + custom fields ──────────────────────────────────────────────────

interface CustomerLike { id: number; email?: string | null; customFields?: Record<string, string> | null; messengerPsid?: string | null; instagramId?: string | null }

export function CustomerFieldsCard({ customer }: { customer: CustomerLike }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: defs } = useCustomerFields();
  const [email, setEmail] = useState(customer.email ?? "");
  const [values, setValues] = useState<Record<string, string>>(customer.customFields ?? {});
  const dirty = email !== (customer.email ?? "") || JSON.stringify(values) !== JSON.stringify(customer.customFields ?? {});
  const save = useMutation({
    mutationFn: () => customFetch(`/api/customers/${customer.id}`, { method: "PUT", body: JSON.stringify({ email, customFields: values }) }),
    onSuccess: () => { toast({ title: "Saved" }); void qc.invalidateQueries({ queryKey: ["/api/customers"] }); void qc.invalidateQueries({ queryKey: [`/api/customers/${customer.id}`] }); },
    onError: (e) => toast({ title: errMsg(e, "Could not save"), variant: "destructive" }),
  });
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3" data-testid="customer-fields-card">
      <h4 className="font-semibold text-sm">More details</h4>
      {(customer.messengerPsid || customer.instagramId) && (
        <div className="flex flex-wrap gap-1.5">
          {customer.messengerPsid && <Badge variant="outline" className="gap-1 font-normal"><FaFacebookMessenger className="h-3 w-3 text-[#0084FF]" /> Messenger</Badge>}
          {customer.instagramId && <Badge variant="outline" className="gap-1 font-normal"><FaInstagram className="h-3 w-3 text-[#E1306C]" /> Instagram</Badge>}
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="cf-email" className="text-xs flex items-center gap-1"><Mail className="h-3 w-3" /> Email</Label>
        <Input id="cf-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-9" />
      </div>
      {(defs ?? []).map((d) => (
        <div key={d.key} className="space-y-1">
          <Label htmlFor={`cf-${d.key}`} className="text-xs">{d.label}</Label>
          {d.type === "select" ? (
            <Select value={values[d.key] ?? "__none"} onValueChange={(v) => setValues({ ...values, [d.key]: v === "__none" ? "" : v })}>
              <SelectTrigger id={`cf-${d.key}`} className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">—</SelectItem>
                {d.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Input id={`cf-${d.key}`} type={d.type === "number" ? "number" : d.type === "date" ? "date" : "text"} value={values[d.key] ?? ""} onChange={(e) => setValues({ ...values, [d.key]: e.target.value })} className="h-9" dir="auto" />
          )}
        </div>
      ))}
      {(defs ?? []).length === 0 && <p className="text-xs text-muted-foreground">Admins can add custom fields (e.g. order number, birthday) in Settings → Customer Fields.</p>}
      <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending} data-testid="btn-save-fields">
        {save.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />} Save
      </Button>
    </div>
  );
}

// ── Timeline ────────────────────────────────────────────────────────────────

interface TimelineRow { type: string; at: string; conversation_id: number | null; channel: string | null; text: string | null; actor: string | null }

const TL: Record<string, { label: string; icon: React.ElementType }> = {
  customer_created: { label: "Became a customer", icon: UserPlus },
  conversation_started: { label: "Conversation started", icon: MessageSquare },
  conversation_resolved: { label: "Conversation completed", icon: CheckCircle2 },
  last_customer_message: { label: "Customer wrote", icon: MessageSquare },
  note: { label: "Internal note", icon: StickyNote },
  template_sent: { label: "Template sent", icon: Mail },
  "conversation.assigned": { label: "Assigned", icon: UserCheck },
  "conversation.takeover": { label: "Supervisor took over", icon: ShieldCheck },
  "conversation.takeover_released": { label: "Handed back", icon: ShieldCheck },
};

export function CustomerTimeline({ customerId }: { customerId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/customers", customerId, "timeline"],
    queryFn: () => customFetch<TimelineRow[]>(`/api/customers/${customerId}/timeline`),
  });
  const rows = useMemo(() => data ?? [], [data]);
  return (
    <div className="rounded-xl border border-border bg-card p-4" data-testid="customer-timeline">
      <h4 className="font-semibold text-sm flex items-center gap-1.5 mb-3"><Activity className="h-4 w-4" /> Activity timeline</h4>
      {isLoading ? <Skeleton className="h-24 w-full" /> : rows.length === 0 ? <p className="text-xs text-muted-foreground">No activity yet.</p> : (
        <ol className="relative border-s border-border ms-2 space-y-3">
          {rows.map((r, i) => {
            const t = TL[r.type] ?? { label: r.type, icon: Activity };
            const Icon = t.icon;
            return (
              <li key={i} className="ms-4">
                <span className="absolute -start-2 mt-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background border border-border"><Icon className="h-2.5 w-2.5 text-primary" /></span>
                <p className="text-sm">
                  <b>{t.label}</b>
                  {r.channel ? <span className="text-muted-foreground"> · {r.channel}</span> : null}
                  {r.actor ? <span className="text-muted-foreground"> · {r.actor}</span> : null}
                  {r.conversation_id ? <a href={`${import.meta.env.BASE_URL}chat?conv=${r.conversation_id}`} className="text-xs text-primary ml-1.5 underline">open chat</a> : null}
                </p>
                {r.text && <p className="text-xs text-muted-foreground line-clamp-2 bidi" dir="auto">{r.text}</p>}
                <time className="text-[11px] text-muted-foreground">{format(parseISO(r.at), "d MMM yyyy, HH:mm")}</time>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// ── Settings → Customer Fields ─────────────────────────────────────────────

export function CustomerFieldsSettings() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: defs, isLoading } = useCustomerFields();
  const [label, setLabel] = useState("");
  const [type, setType] = useState<CustomerField["type"]>("text");
  const [options, setOptions] = useState("");
  const add = useMutation({
    mutationFn: () => customFetch("/api/customer-fields", { method: "POST", body: JSON.stringify({ label, type, options: options.split(/[,،\n]/).map((s) => s.trim()).filter(Boolean) }) }),
    onSuccess: () => { setLabel(""); setOptions(""); void qc.invalidateQueries({ queryKey: ["/api/customer-fields"] }); },
    onError: (e) => toast({ title: errMsg(e, "Could not add"), variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: (id: number) => customFetch(`/api/customer-fields/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["/api/customer-fields"] }),
  });
  return (
    <div className="space-y-4" data-testid="settings-customer-fields">
      <p className="text-sm text-muted-foreground">Extra details stored on every customer (shown on the customer page, included in CSV import/export). The key <code>order_number</code> is also available as the speed-message variable {"{{order_number}}"}.</p>
      {isLoading ? <Skeleton className="h-24 w-full" /> : (
        <ul className="rounded-xl border border-border bg-card divide-y divide-border">
          {(defs ?? []).map((d) => (
            <li key={d.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
              <span className="font-medium flex-1">{d.label}</span>
              <code className="text-xs text-muted-foreground">{d.key}</code>
              <Badge variant="outline" className="font-normal">{d.type}{d.type === "select" ? `: ${d.options.join(", ")}` : ""}</Badge>
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => del.mutate(d.id)}>Remove</Button>
            </li>
          ))}
          {(defs ?? []).length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">No custom fields yet.</li>}
        </ul>
      )}
      <form className="rounded-xl border border-border bg-card p-4 grid gap-3 sm:grid-cols-[1fr_140px_1fr_auto] items-end" onSubmit={(e) => { e.preventDefault(); if (label.trim()) add.mutate(); }}>
        <div className="space-y-1"><Label htmlFor="cfd-label">Label</Label><Input id="cfd-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Order number" className="h-10" /></div>
        <div className="space-y-1">
          <Label>Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as CustomerField["type"])}>
            <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="text">Text</SelectItem><SelectItem value="number">Number</SelectItem><SelectItem value="date">Date</SelectItem><SelectItem value="select">List</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label htmlFor="cfd-opt">Options (lists only)</Label><Input id="cfd-opt" value={options} onChange={(e) => setOptions(e.target.value)} disabled={type !== "select"} placeholder="Gold, Silver" className="h-10" /></div>
        <Button type="submit" className="h-10" disabled={!label.trim() || add.isPending}>Add field</Button>
      </form>
    </div>
  );
}
