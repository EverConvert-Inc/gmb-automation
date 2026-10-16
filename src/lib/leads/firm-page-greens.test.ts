// One green family on the firm page: every green comes from the --fu-*
// tokens (firm-page.css), which match the primary button's emerald classes,
// and every pairing meets WCAG AA in both themes.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const walk = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((f) => {
    const p = join(dir, f);
    return statSync(join(ROOT, p)).isDirectory() ? walk(p) : [p];
  });

/** Every file the firm page renders from. */
const FIRM_PAGE_FILES = [
  ...walk("src/app/admin/firms/[id]").filter((f) => /\.(tsx?)$/.test(f)),
  ...readdirSync(join(ROOT, "src/components/leads"))
    .filter((f) => /^(firm-.*|callrail-company-picker)\.tsx?$/.test(f))
    .map((f) => `src/components/leads/${f}`),
];

const GREEN_CLASS = /\b(?:[a-z-]+:)*(?:bg|text|border|ring|ring-offset|from|via|to|fill|stroke|outline|decoration|shadow|divide|accent|caret)-(?:emerald|green|lime|teal)-\d{2,3}\b/g;

describe("no stray greens on the firm page", () => {
  it("finds the firm page files", () => {
    expect(FIRM_PAGE_FILES).toContain("src/app/admin/firms/[id]/page.tsx");
    expect(FIRM_PAGE_FILES).toContain("src/components/leads/firm-header.tsx");
    expect(FIRM_PAGE_FILES.length).toBeGreaterThan(10);
  });

  it.each(FIRM_PAGE_FILES.filter((f) => !f.endsWith("firm-button.tsx")))(
    "%s: no palette green classes, no green Badge, no raw colour values",
    (f) => {
      const src = read(f);
      expect(src.match(GREEN_CLASS) ?? []).toEqual([]);
      expect(src).not.toContain('variant="success"');
      expect(src).not.toMatch(/#[0-9a-f]{6}\b/i);
    },
  );

  it("the primary button is the one place emerald classes appear — exactly the requested style plus its light pair", () => {
    const greens = [...new Set(read("src/components/leads/firm-button.tsx").match(GREEN_CLASS) ?? [])].sort();
    expect(greens).toEqual(
      [
        "bg-emerald-50",
        "text-emerald-800",
        "border-emerald-200",
        "hover:bg-emerald-100",
        "dark:bg-emerald-950",
        "dark:text-emerald-500",
        "dark:border-emerald-900",
        "dark:hover:bg-emerald-900",
      ].sort(),
    );
  });

  it("the danger button is unchanged", () => {
    expect(read("src/components/leads/firm-button.tsx")).toContain(
      '"rounded-xl bg-gradient-to-t from-red-600 to-red-500 px-4 py-2 text-sm font-medium text-white',
    );
  });
});

// ---------------------------------------------------------------------------
// The tokens: the button's colours, AA in both themes
// ---------------------------------------------------------------------------

const css = read("src/app/admin/firms/[id]/firm-page.css");
const block = (sel: RegExp) => css.match(sel)?.[1] ?? "";
const LIGHT = block(/\n\.firm-ui \{([^}]*)\}/);
const DARK = block(/\n\.dark \.firm-ui \{([^}]*)\}/);
const tok = (b: string, name: string) => b.match(new RegExp(`--fu-${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1]?.toLowerCase();

// Tailwind's emerald scale.
const EMERALD = { 50: "#ecfdf5", 200: "#a7f3d0", 500: "#10b981", 600: "#059669", 700: "#047857", 800: "#065f46", 900: "#064e3b", 950: "#022c22" };

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const WHITE = "#ffffff";
const DARK_CARD = "#0f0f0f"; // the internal app's dark --card (0 0% 6%), as on the portal

describe("the green tokens", () => {
  it("are the primary button's own emerald values", () => {
    expect([tok(LIGHT, "soft"), tok(LIGHT, "border"), tok(LIGHT, "text")]).toEqual([EMERALD[50], EMERALD[200], EMERALD[800]]);
    expect([tok(DARK, "soft"), tok(DARK, "border"), tok(DARK, "text")]).toEqual([EMERALD[950], EMERALD[900], EMERALD[500]]);
    expect(tok(LIGHT, "accent")).toBe(EMERALD[700]);
    expect(tok(DARK, "accent")).toBe(EMERALD[600]);
  });

  it("light mode meets AA: text on badges and on the page; switch and focus visible", () => {
    expect(contrast(tok(LIGHT, "text")!, tok(LIGHT, "soft")!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tok(LIGHT, "text")!, WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tok(LIGHT, "accent")!, WHITE)).toBeGreaterThanOrEqual(3);
    expect(contrast(tok(LIGHT, "focus")!, WHITE)).toBeGreaterThanOrEqual(3);
  });

  it("dark mode meets AA: text on badges and on cards; switch and focus visible", () => {
    expect(contrast(tok(DARK, "text")!, tok(DARK, "soft")!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tok(DARK, "text")!, DARK_CARD)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tok(DARK, "accent")!, DARK_CARD)).toBeGreaterThanOrEqual(3);
    expect(contrast(tok(DARK, "focus")!, DARK_CARD)).toBeGreaterThanOrEqual(3);
  });

  it("every token the components use is defined in both themes", () => {
    const used = new Set(
      FIRM_PAGE_FILES.flatMap((f) => [...read(f).matchAll(/var\(--(fu-[a-z-]+)\)/g)].map((m) => m[1])),
    );
    for (const name of used) {
      expect(LIGHT, name).toContain(`--${name}:`);
      expect(DARK, name).toContain(`--${name}:`);
    }
  });
});
