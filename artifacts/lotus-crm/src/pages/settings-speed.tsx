/**
 * Settings → Speed Messages: predefined replies with categories, "/shortcut"
 * codes, team or personal visibility, variables and usage counts.
 */
import React, { useMemo, useState } from "react";
import { BarChart3, Loader2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
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
import {
  useDeleteSpeedMessage, useSaveSpeedMessage, useSpeedCategories, useSpeedCategoryMutations, useSpeedMessages, useTeams,
  type SpeedMessage,
} from "@/lib/api-extra";
import { SPEED_VARIABLES } from "@/lib/speed";
import { useAuth } from "@/lib/auth";

function errMsg(e: unknown, f: string) { return (e as { data?: { error?: string } })?.data?.error ?? f; }

export function SpeedMessagesSettings() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { data: rows, isLoading } = useSpeedMessages(isAdmin);
  const { data: cats } = useSpeedCategories();
  const catMut = useSpeedCategoryMutations();
  const del = useDeleteSpeedMessage();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [editing, setEditing] = useState<SpeedMessage | "new" | null>(null);
  const [newCat, setNewCat] = useState("");

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows ?? []).filter((r) =>
      (cat === "all" || String(r.categoryId ?? "none") === cat) &&
      (!t || r.title.toLowerCase().includes(t) || r.body.toLowerCase().includes(t) || (r.shortcut ?? "").includes(t.replace(/^\//, ""))),
    );
  }, [rows, q, cat]);
  const top = useMemo(() => [...(rows ?? [])].filter((r) => r.usageCount > 0).sort((a, b) => b.usageCount - a.usageCount).slice(0, 5), [rows]);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_300px]" data-testid="settings-speed">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, text or /shortcut" className="pl-9 h-10" aria-label="Search speed messages" />
          </div>
          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger className="w-44 h-10" aria-label="Category"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="none">Uncategorised</SelectItem>
              {(cats ?? []).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button className="h-10" onClick={() => setEditing("new")} data-testid="btn-add-speed"><Plus className="h-4 w-4 mr-1.5" /> New message</Button>
        </div>

        {isLoading ? <Skeleton className="h-48 w-full" /> : list.length === 0 ? (
          <EmptyState title="No speed messages" hint="Create replies your team sends often. Type / in the chat box to use them." />
        ) : (
          <ul className="rounded-xl border border-border bg-card divide-y divide-border">
            {list.map((r) => (
              <li key={r.id} className="p-3 sm:p-4 flex gap-3" data-testid={`speed-${r.id}`}>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm flex flex-wrap items-center gap-2">
                    {r.title}
                    {r.shortcut && <code className="text-[11px] px-1.5 rounded bg-muted text-primary">/{r.shortcut}</code>}
                    {r.categoryName && <Badge variant="secondary" className="font-normal text-[11px]">{r.categoryName}</Badge>}
                    <Badge variant="outline" className="font-normal text-[11px]">
                      {r.visibility === "all" ? "Everyone" : r.visibility === "team" ? `Team: ${r.teamName ?? "?"}` : `Personal${r.ownerName ? ` · ${r.ownerName}` : ""}`}
                    </Badge>
                  </p>
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3 mt-1 bidi" dir="auto">{r.body}</p>
                  <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">Used {r.usageCount} time{r.usageCount === 1 ? "" : "s"}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setEditing(r)} aria-label={`Edit ${r.title}`}><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" aria-label={`Delete ${r.title}`}
                  onClick={() => del.mutate(r.id, { onError: (e) => toast({ title: errMsg(e, "Could not delete"), variant: "destructive" }) })}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <aside className="space-y-4">
        {isAdmin && (
          <section className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h4 className="font-semibold text-sm">Categories</h4>
            <div className="flex flex-wrap gap-1.5">
              {(cats ?? []).map((c) => (
                <Badge key={c.id} variant="secondary" className="gap-1 font-normal">
                  {c.name}
                  <button type="button" aria-label={`Remove ${c.name}`} onClick={() => catMut.remove.mutate(c.id)}><X className="h-3 w-3" /></button>
                </Badge>
              ))}
              {(cats ?? []).length === 0 && <p className="text-xs text-muted-foreground">No categories yet.</p>}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newCat.trim()) return;
                catMut.create.mutate(newCat.trim(), { onSuccess: () => setNewCat(""), onError: (er) => toast({ title: errMsg(er, "Could not add"), variant: "destructive" }) });
              }}
            >
              <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="e.g. Pricing" className="h-9" aria-label="New category" />
              <Button type="submit" size="sm" className="h-9" disabled={!newCat.trim()}>Add</Button>
            </form>
          </section>
        )}
        <section className="rounded-xl border border-border bg-card p-4 space-y-2">
          <h4 className="font-semibold text-sm flex items-center gap-1.5"><BarChart3 className="h-4 w-4" /> Most used</h4>
          {top.length === 0 ? <p className="text-xs text-muted-foreground">No usage recorded yet.</p> : (
            <ol className="space-y-1 text-sm">
              {top.map((r) => <li key={r.id} className="flex justify-between gap-2"><span className="truncate">{r.title}</span><span className="tabular-nums text-muted-foreground">{r.usageCount}</span></li>)}
            </ol>
          )}
        </section>
      </aside>

      {editing && <SpeedDialog row={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

export function SpeedDialog({ row, onClose }: { row: SpeedMessage | null; onClose: () => void }) {
  const { user } = useAuth();
  const isAgent = user?.role === "agent";
  const { data: cats } = useSpeedCategories();
  const { data: teams } = useTeams();
  const save = useSaveSpeedMessage();
  const { toast } = useToast();
  const [title, setTitle] = useState(row?.title ?? "");
  const [body, setBody] = useState(row?.body ?? "");
  const [shortcut, setShortcut] = useState(row?.shortcut ?? "");
  const [categoryId, setCategoryId] = useState(row?.categoryId ? String(row.categoryId) : "none");
  const [visibility, setVisibility] = useState<SpeedMessage["visibility"]>(row?.visibility ?? (isAgent ? "user" : "all"));
  const [teamId, setTeamId] = useState(row?.teamId ? String(row.teamId) : "");
  const [language, setLanguage] = useState<string>(row?.language ?? "any");
  const ref = React.useRef<HTMLTextAreaElement>(null);

  const insertVar = (token: string) => {
    const ta = ref.current;
    if (!ta) { setBody((b) => b + token); return; }
    const s = ta.selectionStart ?? body.length, e = ta.selectionEnd ?? body.length;
    setBody(body.slice(0, s) + token + body.slice(e));
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(s + token.length, s + token.length); });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate(
      {
        id: row?.id,
        data: {
          title, body, shortcut: shortcut || null,
          categoryId: categoryId === "none" ? null : Number(categoryId),
          visibility, teamId: visibility === "team" && teamId ? Number(teamId) : null,
          language: language === "any" ? null : (language as "en" | "ar"),
        },
      },
      { onSuccess: () => { toast({ title: "Saved" }); onClose(); }, onError: (er) => toast({ title: errMsg(er, "Could not save"), variant: "destructive" }) },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{row ? "Edit speed message" : "New speed message"}</DialogTitle>
          <DialogDescription>Variables are filled in with the chat's details when the message is inserted.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-[1fr_140px] gap-3">
            <div className="space-y-1.5"><Label htmlFor="sm-title">Title</Label><Input id="sm-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={80} className="h-11" /></div>
            <div className="space-y-1.5"><Label htmlFor="sm-short">Shortcut</Label><Input id="sm-short" value={shortcut} onChange={(e) => setShortcut(e.target.value)} placeholder="/price" className="h-11" /></div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sm-body">Message</Label>
            <Textarea id="sm-body" ref={ref} rows={5} value={body} onChange={(e) => setBody(e.target.value)} required maxLength={4000} dir="auto" className="text-sm bidi" placeholder="Hello {{first_name}}, thank you for contacting {{company}}…" />
            <div className="flex flex-wrap gap-1">
              {SPEED_VARIABLES.map((v) => (
                <button key={v.token} type="button" onClick={() => insertVar(v.token)} className="text-[11px] rounded border border-border px-1.5 py-0.5 hover:bg-muted" title={v.label}>{v.token}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {(cats ?? []).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Language</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="ar">العربية</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Who can use it</Label>
              <Select value={visibility} onValueChange={(v) => setVisibility(v as SpeedMessage["visibility"])} disabled={isAgent}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone</SelectItem>
                  <SelectItem value="team">One team</SelectItem>
                  <SelectItem value="user">Only me</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {visibility === "team" && (
              <div className="space-y-1.5">
                <Label>Team</Label>
                <Select value={teamId} onValueChange={setTeamId}>
                  <SelectTrigger className="h-11"><SelectValue placeholder="Choose team" /></SelectTrigger>
                  <SelectContent>{(teams ?? []).map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={save.isPending || !title.trim() || !body.trim()}>{save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
