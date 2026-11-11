/** Minimal RFC-4180 CSV reader/writer (quotes, escaped quotes, CRLF, BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : Array.isArray(v) ? v.join("; ") : String(v);
  // Neutralise spreadsheet formulas (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Phone key used for duplicate detection: last 10 digits ("0100…", "+20 100…", "20100…" match). */
export function phoneKey(phone: string | null | undefined): string {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d;
}
