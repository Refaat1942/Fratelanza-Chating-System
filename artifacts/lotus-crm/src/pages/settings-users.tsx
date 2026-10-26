import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, getListUsersQueryKey } from "@workspace/api-client-react";
import {
  Plus, Search, MoreHorizontal, Pencil, KeyRound, UserX, UserCheck, Trash2, Copy, Check, RefreshCw, Users as UsersIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { EmptyState, ErrorState } from "@/components/states";
import { initials, roleLabel, userLabel, type AppUser } from "@/lib/types";
import { PasswordField } from "@/components/password-field";

const json = { "Content-Type": "application/json" };
const errMsg = (e: unknown, fallback: string) => (e as { data?: { error?: string } }).data?.error ?? fallback;

function tempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const buf = new Uint32Array(12);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join("");
}

function useUsers() {
  return useQuery({
    queryKey: getListUsersQueryKey(),
    queryFn: () => customFetch<AppUser[]>("/api/users"),
  });
}

type Confirm = { kind: "deactivate" | "delete"; user: AppUser } | null;

export function UsersSettings() {
  const { user: me } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: users, isLoading, isError, refetch } = useUsers();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");
  const [editing, setEditing] = useState<AppUser | "new" | null>(null);
  const [resetting, setResetting] = useState<AppUser | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: getListUsersQueryKey() });

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (users ?? []).filter((u) => {
      const active = u.isActive !== false;
      if (filter === "active" && !active) return false;
      if (filter === "inactive" && active) return false;
      if (!needle) return true;
      // case-insensitive across full name, display name and email
      return [u.name, u.displayName, u.email].some((v) => (v ?? "").toLowerCase().includes(needle));
    });
  }, [users, q, filter]);

  const setActive = async (u: AppUser, isActive: boolean) => {
    setBusy(true);
    try {
      await customFetch(`/api/users/${u.id}/active`, { method: "PATCH", headers: json, body: JSON.stringify({ isActive }) });
      toast({ title: isActive ? `${userLabel(u)} activated` : `${userLabel(u)} deactivated` });
      await refresh();
    } catch (e) {
      toast({ title: "Could not update the user", description: errMsg(e, "Try again."), variant: "destructive" });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const remove = async (u: AppUser) => {
    setBusy(true);
    try {
      await customFetch(`/api/users/${u.id}`, { method: "DELETE" });
      toast({ title: `${userLabel(u)} deleted` });
      await refresh();
    } catch (e) {
      toast({ title: "Could not delete the user", description: errMsg(e, "Try again."), variant: "destructive" });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <div className="flex flex-1 gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name or email"
              aria-label="Search users"
              className="pl-9 h-10"
            />
          </div>
          <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <SelectTrigger className="w-[120px] h-10" aria-label="Filter users"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button className="h-10" onClick={() => setEditing("new")} data-testid="btn-add-user">
          <Plus className="h-4 w-4 mr-2" /> Add user
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        {isLoading ? (
          <div className="p-4 space-y-4" aria-busy>
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3"><Skeleton className="h-10 w-10 rounded-full" /><Skeleton className="h-4 w-48" /></div>
            ))}
          </div>
        ) : isError ? (
          <ErrorState title="Could not load users" onRetry={() => void refetch()} />
        ) : shown.length === 0 ? (
          <EmptyState icon={<UsersIcon className="h-10 w-10" />} title="No users found" hint={q ? "Try a different search." : "Add your first teammate."} />
        ) : (
          shown.map((u) => {
            const active = u.isActive !== false;
            const isMe = u.id === me?.id;
            return (
              <div key={u.id} className="flex items-center gap-3 p-3 sm:p-4" data-testid={`user-row-${u.id}`}>
                <Avatar className="h-10 w-10 shrink-0">
                  <AvatarFallback className={active ? "bg-primary/10 text-primary font-semibold" : "bg-muted text-muted-foreground font-semibold"}>
                    {initials(userLabel(u))}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`text-sm font-semibold truncate ${active ? "" : "text-muted-foreground"}`}>{userLabel(u)}</p>
                    {isMe && <Badge variant="outline" className="text-[10px] h-5">You</Badge>}
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <Badge variant="secondary" className="text-[11px] h-5 font-medium">{roleLabel(u.role)}</Badge>
                    <Badge
                      variant="outline"
                      className={`text-[11px] h-5 font-medium ${active ? "border-success/40 text-success bg-success/10" : "border-border text-muted-foreground"}`}
                    >
                      {active ? "Active" : "Inactive"}
                    </Badge>
                    {u.mustChangePassword && <Badge variant="outline" className="text-[11px] h-5 border-warning/40 text-warning bg-warning/10">Must change password</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 truncate">{u.email}</p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label={`Actions for ${userLabel(u)}`} data-testid={`user-menu-${u.id}`}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onClick={() => setEditing(u)}><Pencil className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setResetting(u)}><KeyRound className="h-4 w-4 mr-2" /> Reset password</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {active ? (
                      <DropdownMenuItem disabled={isMe} onClick={() => setConfirm({ kind: "deactivate", user: u })}>
                        <UserX className="h-4 w-4 mr-2" /> Deactivate{isMe ? " (not yourself)" : ""}
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onClick={() => void setActive(u, true)}><UserCheck className="h-4 w-4 mr-2" /> Activate</DropdownMenuItem>
                    )}
                    <DropdownMenuItem disabled={isMe} className="text-destructive focus:text-destructive" onClick={() => setConfirm({ kind: "delete", user: u })}>
                      <Trash2 className="h-4 w-4 mr-2" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })
        )}
      </div>

      {editing && (
        <UserFormDialog
          user={editing === "new" ? null : editing}
          isSelf={editing !== "new" && editing.id === me?.id}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void refresh(); }}
        />
      )}
      {resetting && <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} onDone={() => void refresh()} />}

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "delete" ? `Delete ${confirm ? userLabel(confirm.user) : ""}?` : `Deactivate ${confirm ? userLabel(confirm.user) : ""}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "delete"
                ? "This permanently removes the account. Users with conversation history cannot be deleted — deactivate them instead."
                : "They will be signed out and can no longer log in. Their conversation history is kept and you can reactivate them at any time."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className={confirm?.kind === "delete" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
              onClick={(e) => {
                e.preventDefault();
                if (!confirm) return;
                void (confirm.kind === "delete" ? remove(confirm.user) : setActive(confirm.user, false));
              }}
            >
              {confirm?.kind === "delete" ? "Delete user" : "Deactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ------------------------------------------------------------- create/edit */

function UserFormDialog({
  user, isSelf, onClose, onSaved,
}: { user: AppUser | null; isSelf: boolean; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const isNew = !user;
  const [name, setName] = useState(user?.name ?? "");
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<"admin" | "agent">((user?.role as "admin" | "agent") ?? "agent");
  const [password, setPassword] = useState(isNew ? tempPassword() : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Enter the user's full name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Enter a valid email address.");
    if (isNew && password.length < 8) return setError("Temporary password must be at least 8 characters.");
    setBusy(true);
    try {
      if (isNew) {
        await customFetch("/api/users", {
          method: "POST", headers: json,
          body: JSON.stringify({ name: name.trim(), displayName: displayName.trim(), email: email.trim(), role, password }),
        });
        toast({ title: "User created", description: "They will choose their own password at first sign-in." });
      } else {
        await customFetch(`/api/users/${user!.id}`, {
          method: "PUT", headers: json,
          body: JSON.stringify({ name: name.trim(), displayName: displayName.trim(), email: email.trim(), ...(isSelf ? {} : { role }) }),
        });
        toast({ title: "User updated" });
      }
      onSaved();
    } catch (err) {
      setError(errMsg(err, "Could not save the user."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "Add user" : "Edit user"}</DialogTitle>
          <DialogDescription>{isNew ? "Create a teammate who can sign in to the inbox." : "Update this person's details."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="u-name">Full name</Label>
            <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" required className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-display">Display name <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input id="u-display" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Shown in the app instead of the email" autoComplete="off" className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-email">Email (used to sign in)</Label>
            <Input id="u-email" type="email" inputMode="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as "admin" | "agent")} disabled={isSelf}>
              <SelectTrigger id="u-role" className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="agent">Agent — handles conversations</SelectItem>
                <SelectItem value="admin">Administrator — full access</SelectItem>
              </SelectContent>
            </Select>
            {isSelf && <p className="text-xs text-muted-foreground">You cannot change your own role.</p>}
          </div>
          {isNew && (
            <div className="space-y-1.5">
              <Label htmlFor="u-pass">Temporary password</Label>
              <div className="flex gap-2">
                <div className="flex-1"><PasswordField id="u-pass" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></div>
                <Button type="button" variant="outline" className="h-11 w-11 p-0" onClick={() => setPassword(tempPassword())} aria-label="Generate a password">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Share it securely. The user must replace it at first sign-in.</p>
            </div>
          )}
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy} data-testid="btn-save-user">{busy ? "Saving…" : isNew ? "Create user" : "Save changes"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------- password reset */

function ResetPasswordDialog({ user, onClose, onDone }: { user: AppUser; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [link, setLink] = useState<string | null>(null);
  const [temp, setTemp] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", description: "Select the text and copy it manually.", variant: "destructive" });
    }
  };

  const makeLink = async () => {
    setBusy(true);
    try {
      const res = await customFetch<{ token: string; expiresAt: string }>(`/api/users/${user.id}/reset-link`, { method: "POST" });
      setTemp(null);
      setLink(`${window.location.origin}/reset-password#token=${res.token}`);
    } catch (e) {
      toast({ title: "Could not create a reset link", description: errMsg(e, "Try again."), variant: "destructive" });
    } finally { setBusy(false); }
  };

  const setTemporary = async () => {
    const pw = tempPassword();
    setBusy(true);
    try {
      await customFetch(`/api/users/${user.id}`, { method: "PUT", headers: json, body: JSON.stringify({ password: pw }) });
      setLink(null);
      setTemp(pw);
      onDone();
    } catch (e) {
      toast({ title: "Could not set a temporary password", description: errMsg(e, "Try again."), variant: "destructive" });
    } finally { setBusy(false); }
  };

  const secret = link ?? temp;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reset password for {userLabel(user)}</DialogTitle>
          <DialogDescription>Choose how they get back in. Nothing is emailed — you pass it on yourself.</DialogDescription>
        </DialogHeader>

        {!secret ? (
          <div className="space-y-3">
            <button type="button" onClick={makeLink} disabled={busy} className="w-full text-left rounded-lg border border-border p-3 hover:bg-muted/60 disabled:opacity-60">
              <p className="text-sm font-semibold">Create a reset link</p>
              <p className="text-xs text-muted-foreground mt-0.5">One-time link, valid for 1 hour. They choose their own password.</p>
            </button>
            <button type="button" onClick={setTemporary} disabled={busy} className="w-full text-left rounded-lg border border-border p-3 hover:bg-muted/60 disabled:opacity-60">
              <p className="text-sm font-semibold">Set a temporary password</p>
              <p className="text-xs text-muted-foreground mt-0.5">Replaces their current password now; they must change it at next sign-in.</p>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">{link ? "Send this link to the user. It can be used once and expires in 1 hour." : "Give this temporary password to the user. It is shown only once."}</p>
            <div className="flex gap-2">
              <Input readOnly value={secret} className="h-11 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} aria-label={link ? "Reset link" : "Temporary password"} />
              <Button type="button" className="h-11 w-11 p-0" variant="outline" onClick={() => void copy(secret)} aria-label="Copy">
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Close this window when done — it cannot be shown again.</p>
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>{secret ? "Done" : "Cancel"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
