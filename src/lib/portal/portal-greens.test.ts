// One green family for the whole portal: the --portal-green-* tokens in
// portal-theme.css, with light and dark variants, at WCAG AA contrast.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PORTAL = join(process.cwd(), "src", "app", "(portal)");
const css = readFileSync(join(PORTAL, "portal-theme.css"), "utf8");

function block(selector: RegExp): string {
  const m = css.match(selector);
  if (!m) throw new Error(`no block ${selector}`);
  return m[1];
}
const LIGHT = block(/\n\.portal-theme \{([^}]*)\}/);
const DARK = block(/\n\.portal-theme\.dark \{([^}]*)\}/);
const token = (b: string, name: string) => b.match(new RegExp(`--portal-green-${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];

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

const NAMES = ["soft", "tint", "ring", "text", "solid", "solid-hover", "focus"];

describe("the green tokens", () => {
  it("every token has a light AND a different dark variant", () => {
    for (const n of NAMES) {
      expect(token(LIGHT, n), `light ${n}`).toBeTruthy();
      expect(token(DARK, n), `dark ${n}`).toBeTruthy();
      expect(token(DARK, n), n).not.toBe(token(LIGHT, n));
    }
  });

  // Page / card backgrounds as defined in the same file.
  const SURFACES = {
    light: ["#ffffff", "#f6f7f9"],
    dark: ["#000000", "#0f0f0f"], // pure black page, card at 6%
  };

  it.each([
    ["light", LIGHT, SURFACES.light],
    ["dark", DARK, SURFACES.dark],
  ] as const)("%s: text meets AA on every surface it sits on, white meets AA on the button, focus is visible", (_, b, surfaces) => {
    const t = (n: string) => token(b, n)!;
    for (const bg of [...surfaces, t("soft"), t("tint")]) {
      expect(contrast(t("text"), bg), `text on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast("#ffffff", t("solid"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff", t("solid-hover"))).toBeGreaterThanOrEqual(4.5);
    for (const bg of surfaces) expect(contrast(t("focus"), bg), `focus on ${bg}`).toBeGreaterThanOrEqual(3);
  });
});

describe("no one-off greens", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : [p];
    });
  const sources = files(PORTAL).filter((f) => /\.(tsx?)$/.test(f));

  it("components use the tokens, never the old bright primary/ring classes or a raw green", () => {
    for (const f of sources) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/\b(bg|text|border|ring)-primary\b|ring-ring|border-ring|--portal-accent|--primary\b/);
      expect(src, f).not.toMatch(/#(12b76a|6fb744|22c55e|16a34a)/i);
    }
  });

  it("the primary button is the muted deep green with white text, with hover and disabled states", () => {
    const ui = readFileSync(join(PORTAL, "_components", "ui.ts"), "utf8");
    expect(ui).toMatch(/primary:\s*\n?\s*"bg-\[var\(--portal-green-solid\)\] text-white[^"]*hover:bg-\[var\(--portal-green-solid-hover\)\][^"]*disabled:hover:bg-\[var\(--portal-green-solid\)\]/);
    expect(ui).toMatch(/focus-visible:ring-\[var\(--portal-green-focus\)\]/);
    expect(ui).toMatch(/portalSelected =\s*\n?\s*"bg-\[var\(--portal-green-soft\)\] text-\[var\(--portal-green-text\)\] shadow-\[inset_0_0_0_1px_var\(--portal-green-ring\)\]"/);
  });

  it("the status badges keep their own colours, distinct from each other", () => {
    for (const s of ["signed", "pending", "opportunity"]) expect(css).toContain(`.portal-status-${s} {`);
    expect(css).toMatch(/portal-status-pending \{[^}]*#a16207/);
    expect(css).toMatch(/portal-status-opportunity \{[^}]*#1d4ed8/);
  });
});
