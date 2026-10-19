// The internal app's badge: the portal's soft-tint style, a dark-mode pair
// for every variant, WCAG AA in both themes, and no old pale-mint pills left.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BADGE_COLOURS, Badge, badgeClasses, type BadgeVariant } from "./badge";

// Tailwind v3 palette, the shades the badge uses.
const PALETTE: Record<string, Record<number, string>> = {
  slate: { 400: "#94a3b8", 500: "#64748b", 800: "#1e293b" },
  red: { 400: "#f87171", 500: "#ef4444", 800: "#991b1b" },
  orange: { 400: "#fb923c", 500: "#f97316", 800: "#9a3412" },
  amber: { 400: "#fbbf24", 500: "#f59e0b", 800: "#92400e" },
  yellow: { 400: "#facc15", 500: "#eab308", 800: "#854d0e" },
  lime: { 400: "#a3e635", 500: "#84cc16", 800: "#3f6212" },
  green: { 400: "#4ade80", 500: "#22c55e", 800: "#166534" },
  emerald: { 400: "#34d399", 500: "#10b981", 800: "#065f46" },
  teal: { 400: "#2dd4bf", 500: "#14b8a6", 800: "#115e59" },
  cyan: { 400: "#22d3ee", 500: "#06b6d4", 800: "#155e75" },
  sky: { 400: "#38bdf8", 500: "#0ea5e9", 800: "#075985" },
  blue: { 400: "#60a5fa", 500: "#3b82f6", 800: "#1e40af" },
  indigo: { 400: "#818cf8", 500: "#6366f1", 800: "#3730a3" },
  violet: { 400: "#a78bfa", 500: "#8b5cf6", 800: "#5b21b6" },
  purple: { 400: "#c084fc", 500: "#a855f7", 800: "#6b21a8" },
  fuchsia: { 400: "#e879f9", 500: "#d946ef", 800: "#86198f" },
  pink: { 400: "#f472b6", 500: "#ec4899", 800: "#9d174d" },
  rose: { 400: "#fb7185", 500: "#f43f5e", 800: "#9f1239" },
};

// The surfaces a badge sits on: page, card and row hover (globals.css).
const LIGHT_SURFACES = ["#ffffff", "#f6f7f9", "#f1f2f4"];
const DARK_SURFACES = ["#000000", "#0f0f0f", "#1c1c1c"];

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const over = (fg: string, alpha: number, bg: string) => {
  const f = rgb(fg);
  const b = rgb(bg);
  return "#" + f.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, "0")).join("");
};
const lum = (h: string) => {
  const [r, g, b] = rgb(h).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** Reads one theme's background shade+alpha and text shade back out of the classes. */
function parse(classes: string, colour: string, dark: boolean) {
  const p = dark ? "dark:" : "";
  const bg = classes.match(new RegExp(`(?:^| )${p}bg-${colour}-(\\d+)/\\[([0-9.]+)\\]`));
  const text = classes.match(new RegExp(`(?:^| )${p}text-${colour}-(\\d+)(?: |$)`));
  if (!bg || !text) throw new Error(`${colour} ${dark ? "dark" : "light"}: no bg/text in "${classes}"`);
  return { bgShade: Number(bg[1]), alpha: Number(bg[2]), textShade: Number(text[1]) };
}

describe("every badge colour", () => {
  it("covers the usual set, including green, amber, blue, red and a neutral grey", () => {
    for (const c of ["green", "amber", "blue", "red", "slate"]) expect(BADGE_COLOURS).toContain(c);
    expect(BADGE_COLOURS.sort()).toEqual(Object.keys(PALETTE).sort());
  });

  it.each(Object.keys(PALETTE))("%s has its own dark-mode pair (lighter text, not the light one)", (c) => {
    const cls = badgeClasses(c as BadgeVariant);
    const light = parse(cls, c, false);
    const dark = parse(cls, c, true);
    expect(dark.textShade).toBeLessThan(light.textShade);
  });

  it.each(Object.keys(PALETTE))("%s meets WCAG AA (4.5:1) on every surface, in light and dark", (c) => {
    const cls = badgeClasses(c as BadgeVariant);
    for (const [dark, surfaces] of [[false, LIGHT_SURFACES], [true, DARK_SURFACES]] as const) {
      const { bgShade, alpha, textShade } = parse(cls, c, dark);
      for (const s of surfaces) {
        const bg = over(PALETTE[c][bgShade], alpha, s);
        expect(contrast(PALETTE[c][textShade], bg), `${c} ${dark ? "dark" : "light"} on ${s}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("the names the app already uses", () => {
  it.each([
    ["success", "green"],
    ["warning", "amber"],
    ["destructive", "red"],
    ["secondary", "slate"],
    ["default", "slate"],
    ["info", "blue"],
  ] as const)("%s → %s", (alias, colour) => {
    expect(badgeClasses(alias)).toBe(badgeClasses(colour));
  });

  it("outline is a neutral border, readable in both themes via the theme tokens", () => {
    expect(badgeClasses("outline")).toContain("border-border");
    expect(badgeClasses("outline")).toContain("text-muted-foreground");
  });

  it("renders a span with the portal's shape; sm is the compact size the tables used", () => {
    const html = renderToStaticMarkup(createElement(Badge, { variant: "success" }, "active"));
    expect(html).toMatch(/^<span class="[^"]*rounded-md[^"]*font-medium[^"]*">active<\/span>$/);
    expect(badgeClasses("red", "sm")).toContain("text-[10px]");
  });
});

// ---------------------------------------------------------------------------
// No old pills left on internal pages
// ---------------------------------------------------------------------------

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const ROOT = process.cwd();
const INTERNAL = [...walk(join(ROOT, "src", "app")), ...walk(join(ROOT, "src", "components"))]
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .filter((f) => !f.includes(`${join("src", "app", "(portal)")}`) && !f.includes(join("src", "app", "api")));

// Allowed: the badge itself; the callout component (a notice box with its
// own dark variants, not a badge); the firm page's primary button, whose
// light-mode pair was requested.
const ALLOWED = [join("components", "ui", "badge.tsx"), join("components", "ui", "banner.tsx"), join("components", "leads", "firm-button.tsx")];

describe("no old pale-mint pills on internal pages", () => {
  it("scans the internal files", () => {
    expect(INTERNAL.length).toBeGreaterThan(50);
    expect(INTERNAL.some((f) => f.includes("(portal)"))).toBe(false);
  });

  it("no pale -100 pill tints, no pale green/mint -50 tints, outside the allowed files", () => {
    const PALE =
      /\b(?:hover:)?bg-(?:slate|gray|zinc|neutral|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-100\b|\bbg-(?:green|emerald|lime|teal)-50\b/g;
    const hits = INTERNAL.filter((f) => !ALLOWED.some((a) => f.endsWith(a)))
      .flatMap((f) => (readFileSync(f, "utf8").match(PALE) ?? []).map((m) => `${f.slice(ROOT.length + 1)}: ${m}`));
    expect(hits).toEqual([]);
  });
});
