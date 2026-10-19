// Internal pages: no light-theme-only colours left on the dark theme.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const INTERNAL = [...walk(join(ROOT, "src", "app")), ...walk(join(ROOT, "src", "components"))]
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .filter((f) => !f.includes(join("src", "app", "(portal)")) && !f.includes(join("src", "app", "api")))
  // The badge defines the palette itself.
  .filter((f) => !f.endsWith(join("components", "ui", "badge.tsx")));

const rel = (f: string) => f.slice(ROOT.length + 1);
const lines = (f: string) => readFileSync(f, "utf8").split("\n");

const COLOURS = "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray";

describe("no light-only colours on internal pages", () => {
  it("no pale -50/-100 background (or hover) without a dark variant on the same element", () => {
    const pale = new RegExp(`(?<![\\w-])(?:hover:)?bg-(?:${COLOURS})-(?:50|100)\\b`);
    const hits = INTERNAL.flatMap((f) =>
      lines(f).flatMap((l, i) => (pale.test(l) && !l.includes("dark:") ? [`${rel(f)}:${i + 1}: ${l.trim().slice(0, 90)}`] : [])),
    );
    expect(hits).toEqual([]);
  });

  it("every red/green/amber/emerald/blue text of shade 600 or darker has a dark pair", () => {
    const deep = /(?<![\w:-])text-(?:red|green|amber|emerald|blue|orange|rose|sky|yellow)-(?:600|700|800|900)\b/;
    const hits = INTERNAL.flatMap((f) =>
      lines(f).flatMap((l, i) => (deep.test(l) && !l.includes("dark:text-") ? [`${rel(f)}:${i + 1}: ${l.trim().slice(0, 90)}`] : [])),
    );
    expect(hits).toEqual([]);
  });

  it("the leftovers now use the shared badge colours", () => {
    const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
    expect(read("src/components/scan-management-panel.tsx")).toContain('badgeTone("amber")');
    expect(read("src/components/scan-management-panel.tsx")).toContain('badgeTone(toast.kind === "error" ? "red" : "blue")');
    expect(read("src/components/new-client-form.tsx")).toContain('badgeTone("blue")');
    expect(read("src/components/row-actions.tsx")).toContain(
      "text-red-700 hover:bg-red-500/[0.12] dark:text-red-400 dark:hover:bg-red-500/[0.15]",
    );
  });
});

// ---------------------------------------------------------------------------
// The text pairs now in use meet AA on every surface, in both themes
// ---------------------------------------------------------------------------

const HEX: Record<string, string> = {
  "red-700": "#b91c1c", "red-400": "#f87171",
  "green-800": "#166534", "green-400": "#4ade80",
  "amber-800": "#92400e", "amber-700": "#b45309", "amber-400": "#fbbf24",
  "emerald-700": "#047857", "emerald-400": "#34d399",
};
const lum = (h: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
// Page, card, row hover (globals.css).
const LIGHT = ["#ffffff", "#f6f7f9", "#f1f2f4"];
const DARK = ["#000000", "#0f0f0f", "#1c1c1c"];

describe("text pairs", () => {
  it.each([
    ["red-700", "red-400"],
    ["green-800", "green-400"],
    ["amber-800", "amber-400"],
    ["emerald-700", "emerald-400"],
  ])("%s / dark %s ≥ 4.5:1", (light, dark) => {
    for (const s of LIGHT) expect(contrast(HEX[light], s), `${light} on ${s}`).toBeGreaterThanOrEqual(4.5);
    for (const s of DARK) expect(contrast(HEX[dark], s), `${dark} on ${s}`).toBeGreaterThanOrEqual(4.5);
  });

  it("the amber icon pair (amber-700 / dark amber-400) is visible as a graphic (≥ 3:1)", () => {
    for (const s of LIGHT) expect(contrast(HEX["amber-700"], s)).toBeGreaterThanOrEqual(3);
    for (const s of DARK) expect(contrast(HEX["amber-400"], s)).toBeGreaterThanOrEqual(3);
  });

  it("every pair written into internal files is one of those", () => {
    const pairs = new Set<string>();
    for (const f of INTERNAL) {
      for (const m of readFileSync(f, "utf8").matchAll(/(?<![\w:-])text-(red|green|amber|emerald)-(\d{3}) dark:text-\1-(\d{3})/g)) {
        pairs.add(`${m[1]}-${m[2]}/${m[1]}-${m[3]}`);
      }
    }
    expect([...pairs].sort()).toEqual(
      ["amber-700/amber-400", "amber-800/amber-400", "emerald-700/emerald-400", "green-800/green-400", "red-700/red-400"].sort(),
    );
  });
});
