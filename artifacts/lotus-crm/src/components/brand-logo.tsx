import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Company logo with a neutral fallback mark. The uploaded logo is shown
 * uncropped (object-contain) so wide wordmarks are not cut off.
 */
export function BrandLogo({
  logoUrl,
  name,
  className,
  imgClassName,
}: {
  logoUrl?: string | null;
  name: string;
  className?: string;
  imgClassName?: string;
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
    <div
      className={cn("rounded-lg bg-primary text-primary-foreground flex items-center justify-center", className)}
      aria-label={name}
      role="img"
    >
      <MessageCircle className="h-1/2 w-1/2" />
    </div>
  );
}
