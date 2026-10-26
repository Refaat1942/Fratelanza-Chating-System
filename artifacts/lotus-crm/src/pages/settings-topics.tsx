import React from "react";
import { Plus, Pencil, Trash2, RefreshCw, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { EmptyState } from "@/components/states";
import {
  useChatReasons, useCreateChatReason, useUpdateChatReason, useDeleteChatReason, useReclassifyTopics, type ChatReason,
} from "@/lib/api-extra";

type Draft = { id?: number; nameEn: string; nameAr: string; color: string; keywords: string; isActive: boolean };

const toList = (s: string) => s.split(/[,،\n]/).map((k) => k.trim()).filter(Boolean);

/**
 * Topics group the inbox by what customers write about. Each topic has
 * keywords (English or Arabic); new chats are sorted automatically, and a
 * topic chosen by hand on a chat is never changed by the automation.
 */
export function TopicsSettings() {
  const { data: topics, isLoading } = useChatReasons();
  const create = useCreateChatReason();
  const update = useUpdateChatReason();
  const remove = useDeleteChatReason();
  const refile = useReclassifyTopics();
  const { toast } = useToast();
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [toDelete, setToDelete] = React.useState<ChatReason | null>(null);

  const save = () => {
    if (!draft) return;
    if (!draft.nameEn.trim() || !draft.nameAr.trim()) {
      toast({ title: "Enter the English and Arabic names", variant: "destructive" });
      return;
    }
    const body = { nameEn: draft.nameEn.trim(), nameAr: draft.nameAr.trim(), color: draft.color, keywords: toList(draft.keywords) };
    const done = { onSuccess: () => { toast({ title: draft.id ? "Topic updated — chats are being re-sorted" : "Topic added" }); setDraft(null); }, onError: () => toast({ title: "Could not save the topic", variant: "destructive" }) };
    if (draft.id) update.mutate({ id: draft.id, ...body, isActive: draft.isActive }, done);
    else create.mutate({ ...body, categoryId: null }, done);
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="rounded-xl border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <Sparkles className="h-5 w-5 text-brand-accent shrink-0" aria-hidden />
        <p className="text-sm text-muted-foreground flex-1">
          Every chat is sorted into a topic from the customer's own words. Add the words your customers use — in English or Arabic, separated by commas.
          Topics you pick by hand on a chat are never changed automatically.
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="h-10"
            disabled={refile.isPending}
            onClick={() => refile.mutate(undefined, { onSuccess: (r) => toast({ title: `Re-sorted ${r.checked} chats · ${r.filed} matched a topic` }) })}
            data-testid="btn-refile"
          >
            {refile.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />} Re-sort all chats
          </Button>
          <Button className="h-10" onClick={() => setDraft({ nameEn: "", nameAr: "", color: "#0E7490", keywords: "", isActive: true })} data-testid="btn-add-topic">
            <Plus className="h-4 w-4 mr-2" /> Add topic
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        {isLoading ? (
          <div className="p-4 space-y-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
        ) : !topics?.length ? (
          <EmptyState title="No topics yet" hint="Add a topic with a few keywords to start sorting chats." />
        ) : (
          topics.map((t) => (
            <div key={t.id} className="p-3 sm:p-4 flex items-start gap-3" data-testid={`topic-${t.id}`}>
              <span className="h-3 w-3 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: t.color }} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <p className={`font-semibold ${t.isActive ? "" : "text-muted-foreground line-through"}`}>{t.nameEn}</p>
                  <p className="text-sm text-muted-foreground font-arabic" dir="rtl" lang="ar">{t.nameAr}</p>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {(t.keywords ?? []).slice(0, 14).map((k) => (
                    <span key={k} className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground bidi">{k}</span>
                  ))}
                  {(t.keywords?.length ?? 0) > 14 && <span className="text-[11px] text-muted-foreground">+{(t.keywords?.length ?? 0) - 14} more</span>}
                  {!(t.keywords?.length) && <span className="text-[11px] text-muted-foreground">No keywords — manual only</span>}
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-10 w-10" aria-label={`Edit ${t.nameEn}`}
                onClick={() => setDraft({ id: t.id, nameEn: t.nameEn, nameAr: t.nameAr, color: t.color, keywords: (t.keywords ?? []).join(", "), isActive: t.isActive })}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-10 w-10 text-destructive hover:text-destructive" aria-label={`Delete ${t.nameEn}`} onClick={() => setToDelete(t)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}
      </div>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-w-lg max-h-[92dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit topic" : "Add topic"}</DialogTitle>
            <DialogDescription>Chats whose customers use these words are filed under this topic.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label htmlFor="t-en">English name</Label><Input id="t-en" value={draft.nameEn} onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })} className="h-11" /></div>
                <div className="space-y-1.5"><Label htmlFor="t-ar">Arabic name</Label><Input id="t-ar" dir="rtl" value={draft.nameAr} onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })} className="h-11 font-arabic" /></div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-kw">Keywords</Label>
                <Textarea id="t-kw" rows={5} value={draft.keywords} onChange={(e) => setDraft({ ...draft, keywords: e.target.value })} placeholder="price, quotation, how much, سعر, عرض سعر, بكام" className="text-sm bidi" data-testid="topic-keywords" />
                <p className="text-xs text-muted-foreground">Separate with commas or new lines. English words match whole words; Arabic words also match with prefixes like ال / و / ب, and with or without hamza/tashkeel.</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="space-y-1.5"><Label htmlFor="t-color">Colour</Label><input id="t-color" type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} className="h-11 w-16 rounded-md border border-input bg-background p-1" /></div>
                {draft.id && (
                  <label className="flex items-center gap-2 text-sm mt-6"><Switch checked={draft.isActive} onCheckedChange={(v) => setDraft({ ...draft, isActive: v })} /> Active</label>
                )}
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button onClick={save} disabled={create.isPending || update.isPending} data-testid="btn-save-topic">Save topic</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{toDelete?.nameEn}”?</AlertDialogTitle>
            <AlertDialogDescription>Chats in this topic become “Unsorted”. Messages are not affected.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => toDelete && remove.mutate(toDelete.id, { onSuccess: () => { toast({ title: "Topic deleted" }); setToDelete(null); } })}
            >
              Delete topic
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
