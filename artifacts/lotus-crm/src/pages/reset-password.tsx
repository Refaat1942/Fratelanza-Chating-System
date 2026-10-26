import React from "react";
import { Link, useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth-shell";
import { PasswordField } from "@/components/password-field";
import { Loader2, CheckCircle2 } from "lucide-react";

/** Reset link format: /reset-password#token=…  (fragment → never sent to servers or logged). */
function readToken(): string {
  return new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token") ?? "";
}

export default function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const token = React.useMemo(readToken, []);
  const [pw, setPw] = React.useState("");
  const [pw2, setPw2] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);

  React.useEffect(() => {
    // Remove the token from the address bar / history as soon as it is read.
    if (window.location.hash) history.replaceState(null, "", window.location.pathname);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pw.length < 8) return setError("Password must be at least 8 characters.");
    if (pw !== pw2) return setError("The two passwords do not match.");
    setBusy(true);
    try {
      await customFetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: pw }),
      });
      setDone(true);
      setTimeout(() => setLocation("/login"), 2500);
    } catch (err) {
      setError((err as { data?: { error?: string } }).data?.error ?? "This reset link is invalid or has expired.");
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <AuthShell title="Reset link missing" subtitle="Open the full link your administrator sent you.">
        <Button asChild variant="outline" className="w-full h-11"><Link href="/login">Back to sign in</Link></Button>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title="Password updated">
        <div className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-5 w-5 text-success" /> You can now sign in with your new password.</div>
        <Button asChild className="w-full h-11 mt-5"><Link href="/login">Sign in</Link></Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password" subtitle="At least 8 characters. This link works once and expires after 1 hour.">
      <form onSubmit={submit} className="space-y-4">
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
          {busy ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</>) : "Set new password"}
        </Button>
      </form>
    </AuthShell>
  );
}
