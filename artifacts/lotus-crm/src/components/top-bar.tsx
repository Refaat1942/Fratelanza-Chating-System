import React from "react";
import { Link } from "wouter";
import { Moon, Sun, Circle, KeyRound, LogOut, ChevronDown } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth";
import {
  useBranding,
  useMyAvailability,
  useUpdateMyAvailability,
  useNotReadyReasons,
} from "@/lib/api-extra";
import { NotificationsBell } from "@/components/notifications-bell";
import { BrandLogo } from "@/components/brand-logo";
import { initials, roleLabel, userLabel } from "@/lib/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function TopBar() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const { data: branding } = useBranding();
  const { data: availability } = useMyAvailability();
  const { data: notReadyReasons } = useNotReadyReasons();
  const updateAvailability = useUpdateMyAvailability();

  const companyName = branding?.companyName ?? "Fratelanza";
  const name = userLabel(user);

  const isReady = availability?.isReady ?? true;
  const currentReason = notReadyReasons?.find((r) => r.id === availability?.notReadyReasonId);
  const statusColor = isReady ? "text-success" : "text-warning";
  const statusLabel = isReady ? "Ready" : currentReason ? `Not ready · ${currentReason.value}` : "Not ready";

  return (
    <header
      className="h-14 flex-shrink-0 border-b border-border bg-card shadow-[0_1px_0_0_hsl(var(--border))] flex items-center justify-between gap-2 px-3 md:px-5 pt-safe z-10"
      data-testid="top-bar"
    >
      <div className="flex items-center gap-2 min-w-0">
        <SidebarTrigger className="h-10 w-10 md:hidden" aria-label="Open menu" />
        <div className="flex items-center gap-2 min-w-0 md:hidden">
          <BrandLogo logoUrl={branding?.logoUrl} name={companyName} className="h-7 w-7" imgClassName="h-7 max-w-[120px]" />
          <span className="font-semibold text-sm truncate">{companyName}</span>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-2 px-3 text-xs font-medium" data-testid="btn-availability">
                <Circle className={`h-2 w-2 fill-current ${statusColor}`} aria-hidden />
                <span className="hidden sm:inline">{statusLabel}</span>
                <span className="sm:hidden sr-only">{statusLabel}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Set availability</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => updateAvailability.mutate({ notReadyReasonId: null })} data-testid="availability-ready">
                <Circle className="h-2 w-2 fill-current text-success mr-2" />
                Ready
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">Not ready — pick a reason</DropdownMenuLabel>
              {notReadyReasons?.length ? (
                notReadyReasons.map((r) => (
                  <DropdownMenuItem
                    key={r.id}
                    onClick={() => updateAvailability.mutate({ notReadyReasonId: r.id })}
                    data-testid={`availability-${r.key.toLowerCase()}`}
                  >
                    <Circle className="h-2 w-2 fill-current text-warning mr-2" />
                    {r.value}
                  </DropdownMenuItem>
                ))
              ) : (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">No reasons configured</div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <NotificationsBell />

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="h-10 w-10 text-muted-foreground hover:text-foreground"
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          data-testid="btn-theme-toggle"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-10 gap-2 px-2" data-testid="btn-user-menu" aria-label="Account menu">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                  {initials(name)}
                </AvatarFallback>
              </Avatar>
              <span className="hidden md:flex flex-col items-start leading-tight text-left">
                <span className="text-xs font-medium truncate max-w-[140px]">{name}</span>
                <span className="text-[11px] text-muted-foreground">{roleLabel(user?.role)}</span>
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground hidden md:block" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="font-normal">
              <p className="text-sm font-semibold">{name}</p>
              <p className="text-xs text-muted-foreground">{roleLabel(user?.role)}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/change-password" className="cursor-pointer">
                <KeyRound className="mr-2 h-4 w-4" /> Change password
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => logout()} data-testid="button-logout" className="cursor-pointer">
              <LogOut className="mr-2 h-4 w-4" /> Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
