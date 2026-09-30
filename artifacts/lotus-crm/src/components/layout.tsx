import React from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  LayoutDashboard,
  Sparkles,
  Users,
  FileBarChart,
  Settings,
  Inbox,
  Megaphone,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { AvailabilityToggle } from "@/components/availability-toggle";
import { useBranding, useInsights, useMyPermissions } from "@/lib/api-extra";
import { useInboxSync } from "@/lib/inbox";
import { useIsMobile } from "@/hooks/use-mobile";
import { TopBar } from "@/components/top-bar";
import { BrandLogo } from "@/components/brand-logo";
import { cn } from "@/lib/utils";

function NavLink({
  href,
  icon: Icon,
  label,
  active,
  badge,
  badgeTone = "primary",
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  badge?: number;
  badgeTone?: "primary" | "destructive";
}) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} className="h-10 md:h-9">
        <Link href={href} onClick={() => setOpenMobile(false)} className="flex items-center gap-3">
          <Icon className="h-4 w-4 shrink-0" />
          <span className="flex-1 truncate">{label}</span>
          {!!badge && badge > 0 && (
            <span
              className={cn(
                "min-w-5 h-5 px-1.5 rounded-full text-[11px] font-semibold tabular-nums flex items-center justify-center",
                badgeTone === "destructive"
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-primary text-primary-foreground",
              )}
              aria-label={`${badge} unread`}
            >
              {badge > 99 ? "99+" : badge}
            </span>
          )}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const search = useSearch();
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { data: branding } = useBranding();
  const { data: insights } = useInsights();
  const { data: perms } = useMyPermissions();
  const sync = useInboxSync(!!user && perms?.canViewChats !== false);

  const urgentCount = insights?.summary.urgentCount ?? 0;
  const unread = sync?.unread ?? 0;
  const companyName = branding?.companyName ?? "Fratelanza Chat";
  const isActive = (href: string) => location === href || location.startsWith(href + "/");

  // On phones an open conversation takes the whole screen (its own header + back button).
  const inConversation = isMobile && location === "/chat" && new URLSearchParams(search).has("conv");

  return (
    <div className="flex h-app w-full overflow-hidden bg-background">
      <Sidebar className="border-r border-border">
        <SidebarHeader className="px-4 py-4 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <BrandLogo
              logoUrl={branding?.logoUrl}
              name={companyName}
              className="h-9 w-9 shrink-0"
              imgClassName="h-9 max-w-[140px] shrink-0"
            />
            <span className="font-semibold text-sm leading-tight truncate">{companyName}</span>
          </div>
        </SidebarHeader>

        <SidebarContent className="py-3 px-2">
          <SidebarMenu>
            {perms?.canViewChats !== false && (
              <NavLink href="/chat" icon={Inbox} label="Inbox" active={isActive("/chat")} badge={unread} />
            )}
            {perms?.canManageCustomers !== false && (
              <NavLink href="/customers" icon={Users} label="Customers" active={isActive("/customers")} />
            )}
            <NavLink href="/dashboard" icon={LayoutDashboard} label="Dashboard" active={isActive("/dashboard")} />
            {perms?.canViewChats !== false && (
              <NavLink
                href="/insights"
                icon={Sparkles}
                label="AI Insights"
                active={isActive("/insights")}
                badge={urgentCount}
                badgeTone="destructive"
              />
            )}
            {perms?.canViewReports && (
              <NavLink href="/reports" icon={FileBarChart} label="Reports" active={isActive("/reports")} />
            )}
            {user?.role === "admin" && (
              <NavLink href="/marketing" icon={Megaphone} label="Marketing" active={isActive("/marketing")} />
            )}
            {user?.role === "admin" && (
              <NavLink href="/settings" icon={Settings} label="Settings" active={isActive("/settings")} />
            )}
          </SidebarMenu>
        </SidebarContent>

        <SidebarFooter className="border-t border-border p-3">
          {user?.role === "agent" && <AvailabilityToggle />}
        </SidebarFooter>
      </Sidebar>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {!inConversation && <TopBar />}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>
      </main>
    </div>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <Shell>{children}</Shell>
    </SidebarProvider>
  );
}
