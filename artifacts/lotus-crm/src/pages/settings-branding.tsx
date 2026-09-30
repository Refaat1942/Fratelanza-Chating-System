import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Upload, Trash2, RotateCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { BrandLogo } from "@/components/brand-logo";
import { applyBrandColors } from "@/lib/brand";
import { ErrorState } from "@/components/states";

interface SettingsRow {
  companyName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  slaMinutes: number;
}

const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const MAX_BYTES = 450_000; // base64 must stay under the API's ~700KB limit
const HEX = /^#[0-9a-fA-F]{6}$/;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("Could not read the file"));
    r.readAsDataURL(file);
  });
}

function imageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("This file is not a valid image"));
    img.src = src;
  });
}

function ColorField({
  id, label, value, onChange, hint,
}: { id: string; label: string; value: string; onChange: (v: string) => void; hint: string }) {
  const valid = value === "" || HEX.test(value);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={HEX.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-14 rounded-md border border-input bg-background p-1 cursor-pointer"
        />
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          placeholder="#RRGGBB"
          maxLength={7}
          className="h-11 font-mono max-w-[160px]"
          aria-invalid={!valid}
        />
        {value && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")} aria-label={`Reset ${label}`}>
            <RotateCcw className="h-4 w-4" />
          </Button>
        )}
      </div>
      <p className={`text-xs ${valid ? "text-muted-foreground" : "text-destructive"}`}>{valid ? hint : "Use a 6-digit hex colour like #0a7d5a"}</p>
    </div>
  );
}

export function BrandingSettings() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["/api/settings"],
    queryFn: () => customFetch<SettingsRow>("/api/settings"),
  });

  const [name, setName] = React.useState("");
  const [logo, setLogo] = React.useState<string | null>(null);
  const [primary, setPrimary] = React.useState("");
  const [accent, setAccent] = React.useState("");
  const [sla, setSla] = React.useState(15);
  const [saving, setSaving] = React.useState(false);
  const [readingLogo, setReadingLogo] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!data || loaded) return;
    setName(data.companyName);
    setLogo(data.logoUrl);
    setPrimary(data.primaryColor ?? "");
    setAccent(data.accentColor ?? "");
    setSla(data.slaMinutes);
    setLoaded(true);
  }, [data, loaded]);

  // Live preview of colours while editing; restored from the saved values on leave.
  React.useEffect(() => {
    if (!loaded) return;
    applyBrandColors(HEX.test(primary) ? primary : null, HEX.test(accent) ? accent : null);
  }, [primary, accent, loaded]);
  React.useEffect(
    () => () => applyBrandColors(data?.primaryColor, data?.accentColor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.primaryColor, data?.accentColor],
  );

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ALLOWED.includes(file.type)) {
      toast({ title: "Unsupported file", description: "Use a PNG, JPG, WEBP or SVG image.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({ title: "Logo is too large", description: `Maximum size is ${Math.round(MAX_BYTES / 1000)} KB.`, variant: "destructive" });
      return;
    }
    setReadingLogo(true);
    try {
      const url = await readAsDataUrl(file);
      const { w, h } = await imageSize(url);
      if (w < 64 || h < 32) throw new Error("The image is too small (minimum 64×32 px).");
      if (w > 4096 || h > 4096) throw new Error("The image is too large (maximum 4096×4096 px).");
      setLogo(url);
    } catch (err) {
      toast({ title: "Could not use this image", description: (err as Error).message, variant: "destructive" });
    } finally {
      setReadingLogo(false);
    }
  };

  const valid = name.trim().length > 0 && (primary === "" || HEX.test(primary)) && (accent === "" || HEX.test(accent)) && sla >= 1 && sla <= 1440;
  const dirty =
    !!data &&
    (name.trim() !== data.companyName || logo !== data.logoUrl || primary !== (data.primaryColor ?? "") || accent !== (data.accentColor ?? "") || sla !== data.slaMinutes);

  const save = async () => {
    setSaving(true);
    try {
      await customFetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: name.trim(),
          logoUrl: logo,
          primaryColor: primary || null,
          accentColor: accent || null,
          slaMinutes: sla,
        }),
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["/api/settings"] }),
        qc.invalidateQueries({ queryKey: ["/api/branding"] }),
        qc.invalidateQueries({ queryKey: ["/api/insights"] }),
      ]);
      toast({ title: "Branding saved" });
    } catch (e) {
      toast({ title: "Could not save branding", description: (e as { data?: { error?: string } }).data?.error ?? "Try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <Skeleton className="h-64 w-full max-w-2xl" />;
  if (isError) return <ErrorState title="Could not load branding" onRetry={() => void refetch()} />;

  return (
    <div className="max-w-2xl space-y-6">
      <section className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-4">
        <h4 className="font-semibold">Company</h4>
        <div className="space-y-1.5">
          <Label htmlFor="b-name">Company name</Label>
          <Input id="b-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="h-11" />
        </div>

        <div className="space-y-2">
          <Label>Logo</Label>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-white p-4 flex items-center justify-center h-28">
              <BrandLogo logoUrl={logo} name={name || "Logo"} className="h-14 w-14" imgClassName="max-h-20 max-w-full" />
            </div>
            <div className="rounded-lg border border-border bg-neutral-900 p-4 flex items-center justify-center h-28">
              <BrandLogo logoUrl={logo} name={name || "Logo"} className="h-14 w-14" imgClassName="max-h-20 max-w-full" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="h-10" onClick={() => fileRef.current?.click()} disabled={readingLogo}>
              {readingLogo ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              {logo ? "Replace logo" : "Upload logo"}
            </Button>
            {logo && (
              <Button type="button" variant="ghost" className="h-10 text-destructive hover:text-destructive" onClick={() => setLogo(null)}>
                <Trash2 className="h-4 w-4 mr-2" /> Remove
              </Button>
            )}
            <input ref={fileRef} type="file" accept={ALLOWED.join(",")} className="hidden" onChange={onFile} />
          </div>
          <p className="text-xs text-muted-foreground">PNG, JPG, WEBP or SVG · up to {Math.round(MAX_BYTES / 1000)} KB · between 64×32 and 4096×4096 px. Shown on the sign-in page, sidebar, header and as the browser icon. A wide or square logo on a transparent background works best.</p>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-4">
        <div>
          <h4 className="font-semibold">Brand colours</h4>
          <p className="text-sm text-muted-foreground">Used for buttons, links, your message bubbles and highlights across the whole app. Leave empty for the default theme.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <ColorField id="b-primary" label="Primary colour" value={primary} onChange={setPrimary} hint="Buttons, active menu, outgoing messages." />
          <ColorField id="b-accent" label="Accent colour" value={accent} onChange={setAccent} hint="Secondary highlights such as badges and charts." />
        </div>
        <div className="rounded-lg border border-dashed border-border p-3 flex flex-wrap items-center gap-2" aria-label="Preview">
          <Button type="button" tabIndex={-1}>Primary button</Button>
          <Button type="button" variant="outline" tabIndex={-1}>Outline</Button>
          <span className="rounded-2xl rounded-br-md bg-bubble-out text-bubble-out-foreground px-3 py-1.5 text-sm">Outgoing message</span>
          <span className="rounded-full bg-brand-accent text-brand-accent-foreground px-2.5 py-1 text-xs font-medium">Accent</span>
        </div>
        <p className="text-xs text-muted-foreground">Text colour on top of your colours is chosen automatically for readability.</p>
      </section>

      <section className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-2">
        <h4 className="font-semibold">Response time target</h4>
        <Label htmlFor="b-sla" className="text-sm font-normal text-muted-foreground">Minutes before a waiting customer is flagged “Late”</Label>
        <Input id="b-sla" type="number" inputMode="numeric" min={1} max={1440} value={sla} onChange={(e) => setSla(Number(e.target.value))} className="h-11 max-w-[140px]" />
      </section>

      <div className="sticky bottom-0 -mx-1 bg-background/95 backdrop-blur py-3 flex items-center gap-3 border-t border-border pb-safe">
        <Button className="h-11 px-6" onClick={() => void save()} disabled={!dirty || !valid || saving} data-testid="btn-save-branding">
          {saving ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</>) : "Save branding"}
        </Button>
        {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
      </div>
    </div>
  );
}
