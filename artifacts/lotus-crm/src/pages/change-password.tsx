import React from "react";
import { Link, Redirect } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth-shell";
import { PasswordField } from "@/components/password-field";
import { PageLoader } from "@/components/states";
import { Loader2 } from "lucide-react";

export default function ChangePasswordPage() {
  const { user, isLoading, logout } = useAuth();
  const [cur, setCur] = React.useState("");
  const [pw, setPw] = React.useState("");
  const [pw2, setPw2] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  if (isLoading) return <PageLoader fullScreen />;
  if (!user) return <Redirect to="/login" />;
  const forced = !!user.mustChangePassword;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pw.length < 8) return setError("New password must be at least 8 characters.");
    if (pw !== pw2) return setError("The two new passwords do not match.");
    setBusy(true);
    try {
      await customFetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: cur, newPassword: pw }),
      });
      // Full reload: guarantees the route guard sees the fresh user (the flag
      // that forced this page) instead of a cached copy, and starts a clean session state.
      window.location.assign("/chat");
    } catch (err) {
      setError((err as { data?: { error?: string } }).data?.error ?? "Could not change the password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title={forced ? "Set your own password" : "Change password"}
      subtitle={forced ? "Your administrator gave you a temporary password. Choose a new one to continue." : "Enter your current password, then a new one."}
      footer={
        forced ? (
          <button className="underline" onClick={() => logout()}>Log out</button>
        ) : (
          <Link href="/chat" className="underline">Cancel</Link>
        )
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="cur-pw">{forced ? "Temporary password" : "Current password"}</Label>
          <PasswordField id="cur-pw" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-pw">New password</Label>
          <PasswordField id="new-pw" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-pw2">Confirm new password</Label>
          <PasswordField id="new-pw2" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
        </div>
        {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full h-11" disabled={busy}>
          {busy ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</>) : "Save new password"}
        </Button>
      </form>
    </AuthShell>
  );
}
