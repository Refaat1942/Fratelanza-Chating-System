import { useEffect } from "react";
import { useBranding } from "@/lib/api-extra";
import { applyBrandColors } from "@/lib/brand";

const DEFAULT_TITLE = "Fratelanza";

/**
 * Applies the admin-configured branding to the whole document: colour tokens,
 * tab title, favicon (the uploaded logo) and the mobile browser theme colour.
 */
export function BrandProvider({ children }: { children: React.ReactNode }) {
  const { data: branding } = useBranding();

  useEffect(() => {
    applyBrandColors(branding?.primaryColor, branding?.accentColor);
    const hsl = getComputedStyle(document.documentElement).getPropertyValue("--sidebar").trim();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && hsl) meta.setAttribute("content", `hsl(${hsl})`);
  }, [branding?.primaryColor, branding?.accentColor]);

  useEffect(() => {
    const name = branding?.companyName?.trim() || DEFAULT_TITLE;
    const unread = /^\((\d+\+?)\)\s*/.exec(document.title)?.[0] ?? "";
    document.title = `${unread}${name}`;
    {
      const logo = branding?.logoUrl ?? "/favicon.png";
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.removeAttribute("type");
      link.href = logo;
    }
  }, [branding?.companyName, branding?.logoUrl]);

  return <>{children}</>;
}
