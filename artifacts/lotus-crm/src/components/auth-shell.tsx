import React from "react";
import { useBranding } from "@/lib/api-extra";
import { BrandLogo } from "@/components/brand-logo";

/** Centered card used by login / reset / change-password. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { data: branding } = useBranding();
  const name = branding?.companyName ?? "Fratelanza Chat";
  return (
    <div className="min-h-app w-full flex items-center justify-center bg-background px-4 py-8 pt-safe pb-safe">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-6">
          <BrandLogo
            logoUrl={branding?.logoUrl}
            name={name}
            className="h-16 w-16 mb-4"
            imgClassName="h-16 max-w-[220px] mb-4"
          />
          <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
        </div>
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold">{title}</h2>
          {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
        {footer && <div className="mt-4 text-center text-xs text-muted-foreground">{footer}</div>}
      </div>
    </div>
  );
}
