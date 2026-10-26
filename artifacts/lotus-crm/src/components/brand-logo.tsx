import { cn } from "@/lib/utils";

export const DEFAULT_LOGO = "/brand/fratelanza-medallion-256.webp";
export const DEFAULT_LOGO_LARGE = "/brand/fratelanza-medallion-512.webp";

/**
 * Company logo. Shows the logo uploaded in Settings → Branding; until one is
 * uploaded it shows the official Fratelanza medallion bundled with the app.
 * Uploaded logos are shown uncropped (object-contain).
 */
export function BrandLogo({
  logoUrl,
  name,
  className,
  imgClassName,
  large,
}: {
  logoUrl?: string | null;
  name: string;
  className?: string;
  imgClassName?: string;
  large?: boolean;
}) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={name}
        className={cn("object-contain", imgClassName ?? className)}
        data-testid="brand-logo"
      />
    );
  }
  return (
    <img
      src={large ? DEFAULT_LOGO_LARGE : DEFAULT_LOGO}
      alt={name}
      className={cn("object-contain rounded-full", className)}
      data-testid="brand-logo"
      decoding="async"
    />
  );
}

export function BrandTagline({ className }: { className?: string }) {
  return (
    <p className={cn("leading-snug", className)}>
      <span className="block">Building Tomorrow Together</span>
      <span className="block font-arabic" lang="ar" dir="rtl">نبني الغد معًا</span>
    </p>
  );
}
