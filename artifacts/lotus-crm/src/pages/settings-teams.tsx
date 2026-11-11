/**
 * Settings → Teams: groups of agents with a leader. Chats can be routed to a
 * team (by topic, or transferred by a supervisor); auto-assignment then picks
 * only that team's available agents.
 */
import React, { useState } from "react";
import { useListUsers } from "@workspace/api-client-react";
import { Loader2, Pencil, Plus, Trash2, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, ErrorState } from "@/components/states";
import { useDeleteTeam, useSaveTeam, useSetTeamMembers, useTeams, type Team } from "@/lib/api-extra";
import { roleLabel, userLabel, type AppUser } from "@/lib/types";

function errMsg(e: unknown, fallback: string) {
  return (e as { data?: { error?: string } })?.data?.error ?? fallback;
}

export function TeamsSettings() {
  const { data: teams, isLoading, isError, refetch } = useTeams();
  const [editing, setEditing] = useState<Team | "new" | null>(null);
  const del = useDeleteTeam();
  const { toast } = useToast();

  if (isError) return <ErrorState title="Could not load teams" onRetry={() => void refetch()} />;

  return (
    <div className="space-y-4" data-testid="settings-teams">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground flex-1 min-w-[240px]">
          Group agents into teams. A topic can route its chats to a team (Settings → Chat Topics), and supervisors can transfer chats to a team from the inbox or Live Monitor.
        </p>
        <Button onClick={() => setEditing("new")} data-testid="btn-add-team"><Plus className="h-4 w-4 mr-1.5" /> Add team</Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (teams?.length ?? 0) === 0 ? (
        <EmptyState title="No teams yet" hint="Create teams such as Sales, Pharmacy or Complaints." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {teams!.map((t) => (
            <div key={t.id} className="rounded-xl border border-border bg-card p-4 space-y-3" data-testid={`team-${t.id}`}>
              <div className="flex items-start gap-2">
                <span className="mt-1 h-3 w-3 rounded-full shrink-0" style={{ background: t.color || "hsl(var(--primary))" }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold flex items-center gap-2">{t.name} {!t.isActive && <Badge variant="outline">Inactive</Badge>}</p>
                  {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
                  <p className="text-xs text-muted-foreground mt-0.5">Leader: {t.leaderName ?? "—"}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(t)} aria-label={`Edit ${t.name}`}><Pencil className="h-4 w-4" /></Button>
                <Button
                  variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                  aria-label={`Delete ${t.name}`}
                  onClick={() => {
                    if (!window.confirm(`Delete team "${t.name}"? Its people and chats are kept; they just lose the team.`)) return;
                    del.mutate(t.id, { onSuccess: () => toast({ title: "Team deleted" }), onError: (e) => toast({ title: errMsg(e, "Could not delete"), variant: "destructive" }) });
                  }}
                ><Trash2 className="h-4 w-4" /></Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {t.members.length === 0 ? <span className="text-xs text-muted-foreground">No members</span> : t.members.map((m) => (
                  <Badge key={m.id} variant="secondary" className="font-normal">{m.name}</Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground tabular-nums">
                {t.memberCount} member{t.memberCount === 1 ? "" : "s"} · {t.openChats} open chat{t.openChats === 1 ? "" : "s"} routed here · {t.queued} waiting in the team queue
              </p>
            </div>
          ))}
        </div>
      )}
      {editing && <TeamDialog team={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TeamDialog({ team, onClose }: { team: Team | null; onClose: () => void }) {
  const { toast } = useToast();
  const { data: users } = useListUsers();
  const save = useSaveTeam();
  const setMembers = useSetTeamMembers();
  const [name, setName] = useState(team?.name ?? "");
  const [description, setDescription] = useState(team?.description ?? "");
  const [color, setColor] = useState(team?.color ?? "#0f6e8c");
  const [leaderId, setLeaderId] = useState<string>(team?.leaderId ? String(team.leaderId) : "none");
  const [members, setMembersState] = useState<number[]>(team?.members.map((m) => m.id) ?? []);
  const active = ((users ?? []) as AppUser[]).filter((u) => u.isActive !== false);
  const leaders = active.filter((u) => u.role !== "agent");
  const busy = save.isPending || setMembers.isPending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const saved = await save.mutateAsync({
        id: team?.id,
        data: { name: name.trim(), description: description.trim() || null, color, leaderId: leaderId === "none" ? null : Number(leaderId) },
      });
      await setMembers.mutateAsync({ id: saved.id, userIds: members });
      toast({ title: team ? "Team updated" : "Team created" });
      onClose();
    } catch (err) {
      toast({ title: errMsg(err, "Could not save the team"), variant: "destructive" });
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UsersRound className="h-5 w-5" /> {team ? "Edit team" : "Add team"}</DialogTitle>
          <DialogDescription>Members are moved out of any other team they belonged to.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="t-name">Name</Label>
              <Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-color">Colour</Label>
              <Input id="t-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-11 w-16 p-1" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-desc">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input id="t-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label>Team leader</Label>
            <Select value={leaderId} onValueChange={setLeaderId}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No leader</SelectItem>
                {leaders.map((u) => <SelectItem key={u.id} value={String(u.id)}>{userLabel(u)} · {roleLabel(u.role)}</SelectItem>)}
              </SelectContent>
            </Select>
            {leaders.length === 0 && <p className="text-xs text-muted-foreground">Make someone a Supervisor in Users &amp; Roles to pick them as leader.</p>}
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium mb-1">Members</legend>
            <div className="max-h-56 overflow-y-auto rounded-md border border-border divide-y divide-border">
              {active.map((u) => {
                const checked = members.includes(u.id);
                return (
                  <label key={u.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50">
                    <Checkbox checked={checked} onCheckedChange={(v) => setMembersState((cur) => (v ? [...cur, u.id] : cur.filter((x) => x !== u.id)))} />
                    <span className="flex-1">{userLabel(u)}</span>
                    <span className="text-xs text-muted-foreground">{roleLabel(u.role)}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !name.trim()} data-testid="btn-save-team">{busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
