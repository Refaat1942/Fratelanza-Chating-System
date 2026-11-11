/**
 * Bots (admins): list with live stats, a visual flow editor and a built-in
 * simulator ("Test bot") that runs the exact server engine without sending
 * anything to anyone.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  ArrowDown, Bot as BotIcon, ChevronLeft, CornerDownRight, Loader2, MessageSquare, Plus, Power, RotateCcw, Save, Send, Trash2, UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { EmptyState } from "@/components/states";
import { useChatReasons, useTeams } from "@/lib/api-extra";
import { cn } from "@/lib/utils";

type Action = { type: "route_team"; teamId: number } | { type: "set_topic"; topicId: number } | { type: "tag"; tag: string } | { type: "handover" } | { type: "close" };
interface Option { label: string; next?: string | null; actions?: Action[] }
interface Step { key: string; kind: "message" | "menu" | "question"; text: string; options?: Option[]; saveTo?: string; next?: string | null }
interface OffHours { enabled: boolean; start: string; end: string; days: number[]; message: string }
interface BotRow {
  id: number; name: string; description: string | null; kind: "menu" | "survey" | "action"; channel: string; isActive?: boolean; is_active?: boolean;
  trigger: "new_conversation" | "keyword"; keywords: string[]; welcomeMessage: string | null; fallbackMessage: string | null; handoverMessage: string | null;
  completionMessage: string | null; endAction: "handover" | "close"; maxFallbacks: number; priority: number; offHours: OffHours | null; steps: Step[];
  sessions?: number; active_sessions?: number; completed?: number; handed_over?: number; abandoned?: number; problems?: string[];
}
const errMsg = (e: unknown, f: string) => (e as { data?: { error?: string; problems?: string[] } })?.data?.problems?.join(" · ") ?? (e as { data?: { error?: string } })?.data?.error ?? f;

const STARTER: Omit<BotRow, "id"> = {
  name: "Welcome menu", description: null, kind: "menu", channel: "all", trigger: "new_conversation", keywords: [],
  welcomeMessage: "Welcome to Fratelanza! 👋", fallbackMessage: "Sorry, please reply with the number of an option.",
  handoverMessage: "Thanks — one of our team will reply shortly.", completionMessage: null, endAction: "handover", maxFallbacks: 2, priority: 0,
  offHours: { enabled: false, start: "09:00", end: "21:00", days: [0, 1, 2, 3, 4, 6], message: "We're closed right now — we'll reply as soon as we open." },
  steps: [
    { key: "main", kind: "menu", text: "How can we help you today?", options: [
      { label: "Prices & availability", next: "ask_name", actions: [] },
      { label: "Order status", actions: [{ type: "handover" }] },
      { label: "Talk to someone", actions: [{ type: "handover" }] },
    ] },
    { key: "ask_name", kind: "question", text: "May we have your name?", saveTo: "name" },
  ],
};

export default function BotsPage() {
  const [editing, setEditing] = useState<number | "new" | null>(null);
  return editing === null ? <BotList onOpen={setEditing} /> : <BotEditor id={editing} onBack={() => setEditing(null)} />;
}

function BotList({ onOpen }: { onOpen: (id: number | "new") => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery({ queryKey: ["/api/bots"], queryFn: () => customFetch<BotRow[]>("/api/bots") });
  const toggle = useMutation({
    mutationFn: ({ id, on }: { id: number; on: boolean }) => customFetch(`/api/bots/${id}/active`, { method: "POST", body: JSON.stringify({ isActive: on }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/bots"] }),
    onError: (e) => toast({ title: "Could not change", description: errMsg(e, ""), variant: "destructive" }),
  });
  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-5" data-testid="page-bots">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2"><BotIcon className="h-7 w-7 text-primary" /> Bots</h2>
          <p className="text-muted-foreground text-sm mt-1">Greet new chats, show a menu, collect details and route to the right team — then hand over to a person. Customers can always type “agent”.</p>
        </div>
        <Button onClick={() => onOpen("new")} data-testid="btn-new-bot"><Plus className="h-4 w-4 mr-1.5" /> New bot</Button>
      </div>
      {isLoading ? <Skeleton className="h-40 w-full" /> : !data?.length ? (
        <EmptyState title="No bots yet" hint="Create a welcome menu bot. It stays off until you switch it on." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((b) => {
            const active = b.is_active ?? b.isActive ?? false;
            const total = b.sessions ?? 0;
            return (
              <div key={b.id} className="rounded-xl border border-border bg-card p-4 space-y-3" data-testid={`bot-${b.id}`}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{b.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {b.trigger === "keyword" ? `When a customer writes: ${b.keywords.join(", ")}` : "Greets every new conversation"} · {b.channel === "all" ? "all channels" : b.channel} · {(b.steps ?? []).length} steps
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs">
                    <Switch checked={active} onCheckedChange={(v) => toggle.mutate({ id: b.id, on: v })} aria-label={active ? "Switch off" : "Switch on"} data-testid={`toggle-bot-${b.id}`} />
                    {active ? <span className="text-success font-medium">On</span> : <span className="text-muted-foreground">Off</span>}
                  </label>
                </div>
                <dl className="grid grid-cols-4 gap-2 text-center">
                  {[["Chats", total], ["Handed over", b.handed_over ?? 0], ["Completed", b.completed ?? 0], ["Abandoned", b.abandoned ?? 0]].map(([l, v]) => (
                    <div key={l as string} className="rounded-md bg-muted/50 py-1.5">
                      <dt className="text-[10px] text-muted-foreground uppercase tracking-wide">{l}</dt>
                      <dd className="text-sm font-semibold tabular-nums">{v as number}</dd>
                    </div>
                  ))}
                </dl>
                <Button variant="outline" size="sm" onClick={() => onOpen(b.id)}>Edit flow & test</Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function newKey(steps: Step[]): string {
  let i = steps.length + 1;
  while (steps.some((s) => s.key === `step${i}`)) i++;
  return `step${i}`;
}

function BotEditor({ id, onBack }: { id: number | "new"; onBack: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: loaded, isLoading } = useQuery({
    queryKey: ["/api/bots", id],
    queryFn: () => customFetch<BotRow>(`/api/bots/${id}`),
    enabled: id !== "new",
  });
  const [bot, setBot] = useState<Omit<BotRow, "id"> | null>(id === "new" ? STARTER : null);
  useEffect(() => { if (loaded) setBot({ ...STARTER, ...loaded, offHours: loaded.offHours ?? STARTER.offHours }); }, [loaded]);
  const [savedId, setSavedId] = useState<number | null>(id === "new" ? null : id);
  const save = useMutation({
    mutationFn: () => customFetch<BotRow>(savedId ? `/api/bots/${savedId}` : "/api/bots", { method: savedId ? "PUT" : "POST", body: JSON.stringify(bot) }),
    onSuccess: (b) => { setSavedId(b.id); toast({ title: "Bot saved", description: (b.is_active ?? b.isActive) ? undefined : "It is off — switch it on from the Bots list when ready." }); void qc.invalidateQueries({ queryKey: ["/api/bots"] }); },
    onError: (e) => toast({ title: "Not saved", description: errMsg(e, ""), variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: () => customFetch(`/api/bots/${savedId}`, { method: "DELETE" }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["/api/bots"] }); onBack(); },
  });

  if (isLoading || !bot) return <div className="p-8"><Skeleton className="h-96 w-full" /></div>;
  const set = (patch: Partial<Omit<BotRow, "id">>) => setBot({ ...bot, ...patch });
  const setStep = (i: number, patch: Partial<Step>) => set({ steps: bot.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-5" data-testid="bot-editor">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}><ChevronLeft className="h-4 w-4 mr-1" /> Bots</Button>
        <Input value={bot.name} onChange={(e) => set({ name: e.target.value })} className="h-10 max-w-xs font-semibold" aria-label="Bot name" />
        <div className="ml-auto flex gap-2">
          {savedId && <Button variant="ghost" className="text-destructive" onClick={() => window.confirm("Delete this bot?") && del.mutate()}><Trash2 className="h-4 w-4" /></Button>}
          <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="btn-save-bot">{save.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />} Save</Button>
        </div>
      </div>
      {loaded?.problems && loaded.problems.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning" role="alert">{loaded.problems.join(" · ")}</div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          {/* Settings */}
          <section className="rounded-xl border border-border bg-card p-4 grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Starts when</Label>
              <Select value={bot.trigger} onValueChange={(v) => set({ trigger: v as BotRow["trigger"] })}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new_conversation">A new conversation starts</SelectItem>
                  <SelectItem value="keyword">The customer writes a keyword</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Channel</Label>
              <Select value={bot.channel} onValueChange={(v) => set({ channel: v })}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All channels</SelectItem><SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="messenger">Messenger</SelectItem><SelectItem value="instagram">Instagram</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {bot.trigger === "keyword" && (
              <div className="space-y-1 md:col-span-2">
                <Label htmlFor="b-kw">Keywords (comma separated)</Label>
                <Input id="b-kw" value={bot.keywords.join(", ")} onChange={(e) => set({ keywords: e.target.value.split(/[,،]/).map((s) => s.trim()).filter(Boolean) })} className="h-10" placeholder="menu, start, قائمة" />
              </div>
            )}
            <div className="space-y-1">
              <Label>Bot type</Label>
              <Select value={bot.kind} onValueChange={(v) => set({ kind: v as BotRow["kind"] })}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="menu">Menu bot</SelectItem><SelectItem value="survey">Survey bot</SelectItem><SelectItem value="action">Action bot</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>When the flow ends</Label>
              <Select value={bot.endAction} onValueChange={(v) => set({ endAction: v as BotRow["endAction"] })}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="handover">Hand over to a person</SelectItem><SelectItem value="close">Complete the chat</SelectItem></SelectContent>
              </Select>
            </div>
            {([
              ["welcomeMessage", "Welcome message"], ["fallbackMessage", "When the answer isn't understood"],
              ["handoverMessage", "When handing over to a person"], ["completionMessage", "At the end of the flow (optional)"],
            ] as const).map(([k, l]) => (
              <div key={k} className="space-y-1">
                <Label htmlFor={`b-${k}`}>{l}</Label>
                <Textarea id={`b-${k}`} rows={2} value={bot[k] ?? ""} onChange={(e) => set({ [k]: e.target.value } as Partial<BotRow>)} dir="auto" className="text-sm" />
              </div>
            ))}
            <div className="space-y-1">
              <Label htmlFor="b-fb">Misunderstood answers before handing over</Label>
              <Input id="b-fb" type="number" min={0} max={5} value={bot.maxFallbacks} onChange={(e) => set({ maxFallbacks: Number(e.target.value) })} className="h-10 w-24" />
            </div>
            <div className="space-y-2 md:col-span-2 rounded-lg border border-border p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Switch checked={!!bot.offHours?.enabled} onCheckedChange={(v) => set({ offHours: { ...(bot.offHours ?? STARTER.offHours!), enabled: v } })} /> Opening hours message
              </label>
              {bot.offHours?.enabled && (
                <div className="grid gap-2 sm:grid-cols-[auto_auto_1fr] items-end">
                  <div className="space-y-1"><Label className="text-xs">Open from</Label><Input type="time" value={bot.offHours.start} onChange={(e) => set({ offHours: { ...bot.offHours!, start: e.target.value } })} className="h-9" /></div>
                  <div className="space-y-1"><Label className="text-xs">until</Label><Input type="time" value={bot.offHours.end} onChange={(e) => set({ offHours: { ...bot.offHours!, end: e.target.value } })} className="h-9" /></div>
                  <div className="flex flex-wrap gap-1">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => {
                      const on = bot.offHours!.days.includes(i);
                      return <button key={d} type="button" onClick={() => set({ offHours: { ...bot.offHours!, days: on ? bot.offHours!.days.filter((x) => x !== i) : [...bot.offHours!.days, i] } })} className={cn("rounded border px-2 py-1 text-xs", on ? "bg-primary text-primary-foreground border-primary" : "bg-card")}>{d}</button>;
                    })}
                  </div>
                  <Textarea rows={2} value={bot.offHours.message} onChange={(e) => set({ offHours: { ...bot.offHours!, message: e.target.value } })} className="sm:col-span-3 text-sm" dir="auto" aria-label="Closed message" />
                </div>
              )}
            </div>
          </section>

          {/* Visual flow */}
          <section aria-label="Flow" className="space-y-2">
            <h3 className="font-semibold">Flow</h3>
            {bot.steps.map((s, i) => (
              <React.Fragment key={i}>
                <StepCard step={s} steps={bot.steps} index={i} onChange={(p) => setStep(i, p)} onRemove={() => set({ steps: bot.steps.filter((_, j) => j !== i) })} />
                {i < bot.steps.length - 1 && <div className="flex justify-center text-muted-foreground"><ArrowDown className="h-4 w-4" aria-hidden /></div>}
              </React.Fragment>
            ))}
            <div className="flex flex-wrap gap-2">
              {(["menu", "question", "message"] as const).map((k) => (
                <Button key={k} variant="outline" size="sm" onClick={() => set({ steps: [...bot.steps, { key: newKey(bot.steps), kind: k, text: "", ...(k === "menu" ? { options: [{ label: "", actions: [] }] } : {}), ...(k === "question" ? { saveTo: "answer" } : {}) }] })}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> {k === "menu" ? "Menu" : k === "question" ? "Question" : "Message"}
                </Button>
              ))}
            </div>
          </section>
        </div>

        <Simulator bot={bot} />
      </div>
    </div>
  );
}

function StepCard({ step, steps, index, onChange, onRemove }: { step: Step; steps: Step[]; index: number; onChange: (p: Partial<Step>) => void; onRemove: () => void }) {
  const { data: teams } = useTeams();
  const { data: topics } = useChatReasons();
  const others = steps.filter((s) => s.key !== step.key);
  const goto = (v: string | null | undefined) => (v === undefined ? "__next" : v === null ? "__end" : v);
  const fromGoto = (v: string) => (v === "__next" ? undefined : v === "__end" ? null : v);
  const setOpt = (i: number, p: Partial<Option>) => onChange({ options: (step.options ?? []).map((o, j) => (j === i ? { ...o, ...p } : o)) });
  const actionOf = (o: Option) => {
    const a = (o.actions ?? []).find((x) => x.type === "handover" || x.type === "close");
    return a?.type ?? "continue";
  };
  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-2" data-testid={`step-${index}`}>
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="font-normal capitalize">{index === 0 ? "Start · " : ""}{step.kind}</Badge>
        <Input value={step.key} onChange={(e) => onChange({ key: e.target.value.replace(/[^\w-]/g, "") })} className="h-8 w-32 text-xs font-mono" aria-label="Step id" />
        <Button variant="ghost" size="icon" className="h-8 w-8 ml-auto text-destructive" onClick={onRemove} aria-label="Remove step"><Trash2 className="h-4 w-4" /></Button>
      </div>
      <Textarea rows={2} value={step.text} onChange={(e) => onChange({ text: e.target.value })} placeholder={step.kind === "menu" ? "Question shown above the options" : step.kind === "question" ? "Question to ask" : "Message"} dir="auto" className="text-sm" />
      {step.kind === "question" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Save the answer as</span>
          <Select value={step.saveTo ?? "answer"} onValueChange={(v) => onChange({ saveTo: v })}>
            <SelectTrigger className="h-8 w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="answer">Bot answer only</SelectItem>
              <SelectItem value="name">Customer name</SelectItem>
              <SelectItem value="email">Customer email</SelectItem>
              <SelectItem value="custom:order_number">Custom field: order_number</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {step.kind === "menu" && (
        <div className="space-y-2">
          {(step.options ?? []).map((o, i) => {
            const team = (o.actions ?? []).find((a) => a.type === "route_team") as { teamId: number } | undefined;
            const topic = (o.actions ?? []).find((a) => a.type === "set_topic") as { topicId: number } | undefined;
            const keep = (o.actions ?? []).filter((a) => a.type === "tag");
            const rebuild = (t: string, tm: string, tp: string) => [
              ...(tm !== "none" ? [{ type: "route_team" as const, teamId: Number(tm) }] : []),
              ...(tp !== "none" ? [{ type: "set_topic" as const, topicId: Number(tp) }] : []),
              ...keep,
              ...(t === "handover" ? [{ type: "handover" as const }] : t === "close" ? [{ type: "close" as const }] : []),
            ];
            return (
              <div key={i} className="rounded-lg bg-muted/40 p-2 grid gap-2 sm:grid-cols-[24px_1fr_auto] items-start">
                <span className="text-sm font-semibold text-center mt-2">{i + 1}.</span>
                <div className="space-y-2">
                  <Input value={o.label} onChange={(e) => setOpt(i, { label: e.target.value })} placeholder="Option label" className="h-9" dir="auto" />
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <CornerDownRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    <Select value={actionOf(o)} onValueChange={(v) => setOpt(i, { actions: rebuild(v, team ? String(team.teamId) : "none", topic ? String(topic.topicId) : "none") })}>
                      <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="continue">Continue to…</SelectItem><SelectItem value="handover">Hand over to a person</SelectItem><SelectItem value="close">Complete the chat</SelectItem></SelectContent>
                    </Select>
                    {actionOf(o) === "continue" && (
                      <Select value={goto(o.next)} onValueChange={(v) => setOpt(i, { next: fromGoto(v) })}>
                        <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__next">Next step</SelectItem>
                          <SelectItem value="__end">End of flow</SelectItem>
                          {others.map((s) => <SelectItem key={s.key} value={s.key}>{s.key}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                    <Select value={team ? String(team.teamId) : "none"} onValueChange={(v) => setOpt(i, { actions: rebuild(actionOf(o), v, topic ? String(topic.topicId) : "none") })}>
                      <SelectTrigger className="h-8 w-36"><SelectValue placeholder="Team" /></SelectTrigger>
                      <SelectContent><SelectItem value="none">No team</SelectItem>{(teams ?? []).map((t) => <SelectItem key={t.id} value={String(t.id)}>Team: {t.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={topic ? String(topic.topicId) : "none"} onValueChange={(v) => setOpt(i, { actions: rebuild(actionOf(o), team ? String(team.teamId) : "none", v) })}>
                      <SelectTrigger className="h-8 w-36"><SelectValue placeholder="Topic" /></SelectTrigger>
                      <SelectContent><SelectItem value="none">No topic</SelectItem>{(topics ?? []).map((t) => <SelectItem key={t.id} value={String(t.id)}>Topic: {t.nameEn}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Remove option" onClick={() => onChange({ options: (step.options ?? []).filter((_, j) => j !== i) })}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            );
          })}
          {(step.options?.length ?? 0) < 10 && (
            <Button variant="ghost" size="sm" onClick={() => onChange({ options: [...(step.options ?? []), { label: "", actions: [] }] })}><Plus className="h-3.5 w-3.5 mr-1" /> Option</Button>
          )}
        </div>
      )}
      {step.kind !== "menu" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CornerDownRight className="h-3.5 w-3.5" aria-hidden /> Then
          <Select value={goto(step.next)} onValueChange={(v) => onChange({ next: fromGoto(v) })}>
            <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="__next">Next step</SelectItem><SelectItem value="__end">End of flow</SelectItem>{others.map((s) => <SelectItem key={s.key} value={s.key}>{s.key}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

interface SimTurn { replies: string[]; state: { stepKey: string | null; answers: Record<string, string>; fallbacks: number }; end: string | null; actions: Action[]; saves: { field: string; value: string }[] }

function Simulator({ bot }: { bot: Omit<BotRow, "id"> }) {
  const [lines, setLines] = useState<{ who: "bot" | "me" | "info"; text: string }[]>([]);
  const [state, setState] = useState<SimTurn["state"] | null>(null);
  const [ended, setEnded] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const { data: teams } = useTeams();
  const { data: topics } = useChatReasons();
  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [lines.length]);

  const describe = (t: SimTurn) => {
    const out: string[] = [];
    for (const a of t.actions) {
      if (a.type === "route_team") out.push(`→ routed to team ${teams?.find((x) => x.id === a.teamId)?.name ?? a.teamId}`);
      if (a.type === "set_topic") out.push(`→ topic set: ${topics?.find((x) => x.id === a.topicId)?.nameEn ?? a.topicId}`);
      if (a.type === "tag") out.push(`→ list/tag added: ${a.tag}`);
      if (a.type === "handover") out.push("→ handed over to a person (auto-assignment runs)");
      if (a.type === "close") out.push("→ chat completed");
    }
    for (const s of t.saves) out.push(`→ saved ${s.field} = “${s.value}”`);
    return out;
  };
  const run = async (text: string | null) => {
    setBusy(true);
    try {
      const t = await customFetch<SimTurn>("/api/bots/simulate", { method: "POST", body: JSON.stringify({ bot, state: text === null ? undefined : state, input: text }) });
      setLines((l) => [...l, ...(text !== null ? [{ who: "me" as const, text }] : []), ...t.replies.map((r) => ({ who: "bot" as const, text: r })), ...describe(t).map((d) => ({ who: "info" as const, text: d }))]);
      setState(t.state);
      setEnded(!!t.end);
    } finally {
      setBusy(false);
    }
  };
  const reset = () => { setLines([]); setState(null); setEnded(false); void run(null); };

  return (
    <aside className="rounded-xl border border-border bg-card flex flex-col h-[560px] xl:sticky xl:top-4" aria-label="Test bot" data-testid="bot-simulator">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <MessageSquare className="h-4 w-4 text-primary" />
        <p className="font-semibold text-sm flex-1">Test bot <span className="font-normal text-muted-foreground">— nothing is sent</span></p>
        <Button size="sm" variant="outline" onClick={reset} data-testid="btn-sim-start">{lines.length ? <RotateCcw className="h-3.5 w-3.5 mr-1" /> : <Power className="h-3.5 w-3.5 mr-1" />}{lines.length ? "Restart" : "Start"}</Button>
      </div>
      <div className="flex-1 overflow-y-auto bg-wallpaper p-3 space-y-1.5">
        {lines.length === 0 && <p className="text-xs text-muted-foreground text-center mt-8">Press Start to see what a customer would get, then reply as the customer.</p>}
        {lines.map((l, i) => l.who === "info" ? (
          <p key={i} className="text-[11px] text-center text-muted-foreground italic">{l.text}</p>
        ) : (
          <div key={i} className={cn("flex", l.who === "me" ? "justify-start" : "justify-end")}>
            <div className={cn("max-w-[85%] rounded-2xl px-3 py-1.5 text-sm whitespace-pre-wrap bidi", l.who === "me" ? "bg-bubble-in text-bubble-in-foreground border border-border" : "bg-bubble-out text-bubble-out-foreground")} dir="auto">
              {l.who === "me" ? <UserRound className="inline h-3 w-3 mr-1 opacity-60" /> : <BotIcon className="inline h-3 w-3 mr-1 opacity-70" />}{l.text}
            </div>
          </div>
        ))}
        {ended && <p className="text-xs text-center font-medium text-primary pt-2">Bot finished.</p>}
        <div ref={endRef} />
      </div>
      <form className="flex gap-2 p-2 border-t border-border" onSubmit={(e) => { e.preventDefault(); if (input.trim() && state && !ended) { void run(input.trim()); setInput(""); } }}>
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={state && !ended ? "Reply as the customer…" : "Start the test first"} disabled={!state || ended || busy} className="h-9" dir="auto" data-testid="sim-input" />
        <Button type="submit" size="sm" className="h-9" disabled={!input.trim() || !state || ended || busy} aria-label="Send"><Send className="h-4 w-4" /></Button>
      </form>
    </aside>
  );
}
