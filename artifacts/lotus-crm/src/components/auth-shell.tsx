import React from "react";
import { useBranding } from "@/lib/api-extra";
import { BrandLogo } from "@/components/brand-logo";

const NAVY_BG = "linear-gradient(145deg, hsl(var(--navy)) 0%, hsl(var(--navy-light)) 100%)";

/** Split brand panel + form card used by login / reset / change password. */
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
  const name = branding?.companyName ?? "Fratelanza";
  const custom = branding?.logoUrl;

  return (
    <div className="min-h-app w-full grid lg:grid-cols-[1.1fr_1fr] bg-background">
      {/* Brand panel (desktop) */}
      <aside
        className="relative hidden lg:flex flex-col items-center justify-center text-white overflow-hidden px-12"
        style={{ background: NAVY_BG }}
      >
        <div
          aria-hidden
          className="absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(60% 50% at 50% 38%, hsl(var(--gold) / 0.22) 0%, transparent 70%), radial-gradient(40% 35% at 85% 90%, hsl(var(--cyan) / 0.14) 0%, transparent 70%)",
          }}
        />
        <div className="relative flex flex-col items-center text-center max-w-md">
          <div className="w-64 h-64 flex items-center justify-center">
            {custom ? (
              <div className="rounded-2xl bg-white p-5 shadow-2xl">
                <BrandLogo logoUrl={custom} name={name} imgClassName="max-h-40 max-w-[220px]" />
              </div>
            ) : (
              <BrandLogo name={name} large className="w-64 h-64 shadow-2xl ring-1 ring-white/10" />
            )}
          </div>
          <h1 className="mt-10 text-4xl font-extrabold tracking-tight">Building Tomorrow Together</h1>
          <p className="mt-2 text-2xl font-bold font-arabic text-[hsl(var(--soft-gold))]" lang="ar" dir="rtl">نبني الغد معًا</p>
          <p className="mt-8 text-[11px] font-semibold tracking-[0.22em] uppercase text-white/60">
            Technology • ERP • AI • Cloud • Digital Transformation
          </p>
        </div>
        <p className="absolute bottom-6 text-xs text-white/40">© {new Date().getFullYear()} {name}</p>
      </aside>

      {/* Form side */}
      <main className="flex flex-col min-h-app">
        {/* Brand band (mobile / tablet) */}
        <header className="lg:hidden text-white text-center px-6 pt-safe pb-14" style={{ background: NAVY_BG }}>
          <div className="pt-8 flex flex-col items-center">
            {custom ? (
              <div className="rounded-xl bg-white p-2.5 shadow-lg">
                <BrandLogo logoUrl={custom} name={name} imgClassName="h-14 max-w-[200px]" />
              </div>
            ) : (
              <BrandLogo name={name} className="h-24 w-24 shadow-xl ring-1 ring-white/10" />
            )}
            <p className="mt-4 text-lg font-extrabold tracking-tight">Building Tomorrow Together</p>
            <p className="text-base font-bold font-arabic text-[hsl(var(--soft-gold))]" lang="ar" dir="rtl">نبني الغد معًا</p>
          </div>
        </header>

        <div className="flex-1 flex items-start lg:items-center justify-center px-4 pb-8 -mt-8 lg:mt-0 lg:px-10 pb-safe">
          <div className="w-full max-w-sm">
            <div className="rounded-2xl border border-border bg-card p-6 sm:p-7 shadow-lg">
              <h2 className="text-xl font-extrabold tracking-tight">{title}</h2>
              {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
              <div className="mt-5">{children}</div>
            </div>
            {footer && <div className="mt-4 text-center text-xs text-muted-foreground">{footer}</div>}
          </div>
        </div>
      </main>
    </div>
  );
}
