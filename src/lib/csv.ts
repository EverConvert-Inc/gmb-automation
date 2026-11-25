// Minimal CSV writer for client-side "Export CSV" buttons. RFC 4180 quoting
// (a cell with a comma, quote or newline is wrapped in quotes, inner quotes
// doubled). Text cells that a spreadsheet would run as a formula (starting
// with = + - @ or a tab/CR) get a leading apostrophe; numbers are written
// as-is, so a negative number stays a number.

export type CsvCell = string | number | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  const text = FORMULA_START.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// Browser-only: hands the CSV to the user as a file download.
export function downloadCsv(filename: string, csv: string): void {
  // BOM so Excel reads the file as UTF-8 (account names can carry accents).
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
