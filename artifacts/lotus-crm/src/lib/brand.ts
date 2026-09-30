/**
 * Runtime branding: turns the two hex colours chosen in Settings → Branding
 * into the design-token variables defined in src/theme.css. When no colour is
 * configured the CSS defaults apply (nothing is written).
 */

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0, s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Pick whichever of white / near-black gives the higher WCAG contrast. */
function readableOn(rgb: [number, number, number]): string {
  const L = luminance(rgb);
  const contrastWhite = 1.05 / (L + 0.05);
  const contrastDark = (L + 0.05) / 0.058;
  return contrastWhite >= contrastDark ? "0 0% 100%" : "222 35% 8%";
}

const VARS = [
  "--primary", "--primary-foreground", "--ring",
  "--brand-accent", "--brand-accent-foreground",
  "--sidebar-primary", "--sidebar-primary-foreground", "--sidebar-ring",
  "--bubble-out", "--bubble-out-foreground",
];

/**
 * Optional per-deployment overrides from Settings → Branding. With nothing
 * configured the Fratelanza palette in theme.css applies untouched.
 */
export function applyBrandColors(primaryHex?: string | null, accentHex?: string | null): void {
  const root = document.documentElement;
  for (const v of VARS) root.style.removeProperty(v);

  const p = primaryHex ? hexToRgb(primaryHex) : null;
  if (p) {
    const [h, s, l] = rgbToHsl(p);
    const hsl = `${h} ${s}% ${l}%`;
    root.style.setProperty("--primary", hsl);
    root.style.setProperty("--primary-foreground", readableOn(p));
    root.style.setProperty("--ring", hsl);
    root.style.setProperty("--bubble-out", hsl);
    root.style.setProperty("--bubble-out-foreground", readableOn(p));
  }
  const a = accentHex ? hexToRgb(accentHex) : null;
  if (a) {
    const [h, s, l] = rgbToHsl(a);
    const hsl = `${h} ${s}% ${l}%`;
    root.style.setProperty("--brand-accent", hsl);
    root.style.setProperty("--brand-accent-foreground", readableOn(a));
    root.style.setProperty("--sidebar-primary", hsl);
    root.style.setProperty("--sidebar-primary-foreground", readableOn(a));
    root.style.setProperty("--sidebar-ring", hsl);
  }
}
