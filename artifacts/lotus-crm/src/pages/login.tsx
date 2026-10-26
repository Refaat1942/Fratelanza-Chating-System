import React from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLogin } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth-shell";
import { PasswordField } from "@/components/password-field";
import { Loader2 } from "lucide-react";

const loginSchema = z.object({
  email: z.string().trim().min(1, "Enter your email").email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});
type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { login, user } = useAuth();
  const loginMutation = useLogin();
  const [formError, setFormError] = React.useState<string | null>(null);
  const expired = new URLSearchParams(window.location.search).has("expired");

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  React.useEffect(() => {
    if (user) setLocation("/chat");
  }, [user, setLocation]);

  const onSubmit = (data: LoginFormValues) => {
    setFormError(null);
    loginMutation.mutate(
      { data: { email: data.email.trim().toLowerCase(), password: data.password } },
      {
        onSuccess: (res) => {
          login(res.token);
          setLocation("/chat");
        },
        onError: (err) => {
          const status = (err as { status?: number }).status;
          setFormError(
            status === 429
              ? "Too many attempts. Please wait a few minutes and try again."
              : (err.data as { error?: string } | null)?.error ||
                  "Could not sign in. Check your email and password.",
          );
        },
      },
    );
  };

  return (
    <AuthShell
      title="Sign in"
      subtitle="Use your work email and password."
      footer="Authorized personnel only. Forgot your password? Ask your administrator for a reset link."
    >
      {expired && !formError && (
        <p role="status" className="mb-4 rounded-md bg-muted px-3 py-2 text-sm">
          Your session has ended. Please sign in again.
        </p>
      )}
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="you@company.com"
            className="h-11"
            aria-invalid={!!form.formState.errors.email}
            aria-describedby={form.formState.errors.email ? "email-err" : undefined}
            {...form.register("email")}
            data-testid="input-email"
          />
          {form.formState.errors.email && (
            <p id="email-err" className="text-sm text-destructive">{form.formState.errors.email.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <PasswordField
            id="password"
            autoComplete="current-password"
            placeholder="••••••••"
            aria-invalid={!!form.formState.errors.password}
            aria-describedby={form.formState.errors.password ? "pw-err" : undefined}
            {...form.register("password")}
            data-testid="input-password"
          />
          {form.formState.errors.password && (
            <p id="pw-err" className="text-sm text-destructive">{form.formState.errors.password.message}</p>
          )}
        </div>

        {formError && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="login-error">
            {formError}
          </p>
        )}

        <Button type="submit" className="w-full h-11 text-base" disabled={loginMutation.isPending} data-testid="button-submit-login">
          {loginMutation.isPending ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in…</>) : "Sign in"}
        </Button>
      </form>
    </AuthShell>
  );
}
