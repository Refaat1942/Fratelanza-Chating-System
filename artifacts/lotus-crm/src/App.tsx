import React, { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { setBaseUrl } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useMyPermissions, type EffectivePermissions } from "@/lib/api-extra";
import { AppLayout } from "@/components/layout";
import { BrandProvider } from "@/components/brand-provider";
import { PageLoader } from "@/components/states";

// Pages
import LoginPage from "@/pages/login";
import ResetPasswordPage from "@/pages/reset-password";
import ChangePasswordPage from "@/pages/change-password";
import DashboardPage from "@/pages/dashboard";
import ChatPage from "@/pages/chat";
import CustomersPage from "@/pages/customers";
import ReportsPage from "@/pages/reports";
import SettingsPage from "@/pages/settings";
import InsightsPage from "@/pages/insights";
import MarketingPage from "@/pages/marketing";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

type PageComponent = React.ComponentType<Record<string, never>>;

function Guard({
  component: Component,
  permission,
  admin,
  fallback = "/dashboard",
}: {
  component: PageComponent;
  permission?: keyof EffectivePermissions;
  admin?: boolean;
  fallback?: string;
}) {
  const { user } = useAuth();
  const { data: perms, isLoading } = useMyPermissions();
  if (admin && user?.role !== "admin") return <Redirect to={fallback} />;
  if (permission) {
    if (isLoading) return <PageLoader />;
    if (!perms?.[permission]) return <Redirect to={fallback} />;
  }
  return <Component />;
}

/** Everything behind login. The layout is mounted ONCE, not per page. */
function ProtectedApp() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <PageLoader fullScreen />;
  if (!user) return <Redirect to="/login" />;
  if (user.mustChangePassword) return <Redirect to="/change-password" />;

  return (
    <AppLayout>
      <Switch>
        <Route path="/dashboard">{() => <Guard component={DashboardPage} />}</Route>
        <Route path="/chat">{() => <Guard component={ChatPage} permission="canViewChats" />}</Route>
        <Route path="/customers">{() => <Guard component={CustomersPage} permission="canManageCustomers" />}</Route>
        <Route path="/reports">{() => <Guard component={ReportsPage} permission="canViewReports" />}</Route>
        <Route path="/insights">{() => <Guard component={InsightsPage} permission="canViewChats" />}</Route>
        <Route path="/marketing">{() => <Guard component={MarketingPage} admin />}</Route>
        <Route path="/settings">{() => <Guard component={SettingsPage} admin />}</Route>
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function Router() {
  const { user, isLoading } = useAuth();
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/change-password" component={ChangePasswordPage} />
      {/* The Inbox is the landing screen after sign-in */}
      <Route path="/">
        {() => (isLoading ? <PageLoader fullScreen /> : <Redirect to={user ? "/chat" : "/login"} />)}
      </Route>
      <Route component={ProtectedApp} />
    </Switch>
  );
}

function App() {
  useEffect(() => {
    // Set the API base URL for the generated client
    const apiUrl = import.meta.env.DEV ? "" : window.location.origin;
    setBaseUrl(apiUrl);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="fratelanza-theme">
        <TooltipProvider>
          <AuthProvider>
            <BrandProvider>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <Router />
              </WouterRouter>
              <Toaster />
            </BrandProvider>
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
