// One green family in the admin lead editor drawer: every green comes from
// the firm page's --fu-* tokens (firm-page.css) or the firm page's primary
// button, and every pairing on the drawer's card meets WCAG AA in both themes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Every file the drawer renders from (the firm button has its own test). */
const DRAWER_FILES = [
  "src/components/leads/admin-lead-drawer.tsx",
  "src/components/leads/admin-lead-actions.tsx",
  "src/components/leads/admin-lead-drawer-store.ts",
  "src/components/leads/source-label.ts",
];

const GREEN_CLASS = /\b(?:[a-z-]+:)*(?:bg|text|border|ring|ring-offset|from|via|to|fill|stroke|outline|decoration|shadow|divide|accent|caret)-(?:emerald|green|lime|teal)-\d{2,3}\b/g;

describe("no stray greens in the lead drawer", () => {
  it.each(DRAWER_FILES)("%s: no palette green classes, no green Badge, no raw colour values", (f) => {
    const src = read(f);
    expect(src.match(GREEN_CLASS) ?? []).toEqual([]);
    expect(src).not.toContain('variant="success"');
    expect(src).not.toMatch(/#[0-9a-f]{6}\b/i);
    // The app's lime --primary is not the firm page's green.
    expect(src).not.toMatch(/\b(?:bg|text|border)-primary\b/);
  });

  const drawer = read("src/components/leads/admin-lead-drawer.tsx");

  it("scopes itself to the firm page's tokens and uses only those", () => {
    expect(drawer).toContain('import "@/app/admin/firms/[id]/firm-page.css"');
    expect(drawer).toContain('"firm-ui ');
    const used = [...new Set([...drawer.matchAll(/var\(--([a-z-]+)\)/g)].map((m) => m[1]))];
    expect(used.every((t) => t.startsWith("fu-"))).toBe(true);
  });

  it("Save and Add note: solid green with a white label when enabled, muted grey when disabled", () => {
    expect(drawer).toMatch(/const ENABLED_BUTTON =\s*"[^"]*bg-\[var\(--fu-solid\)\] text-white/);
    expect(drawer).toMatch(/const DISABLED_BUTTON = "[^"]*bg-muted text-muted-foreground/);
    expect(drawer).toContain("disabled ? DISABLED_BUTTON : ENABLED_BUTTON");
    expect(drawer).not.toContain("<FirmButton");
    expect(drawer).not.toContain("firmButtonClasses");
  });

  it("the Revert link is neutral text, not green", () => {
    expect(drawer).not.toContain("fuGreenText");
    expect(drawer).toMatch(/className="font-medium text-foreground underline[^"]*"[^>]*>\s*Revert to/);
  });

  it("the note label is grey with a green dot, not green text", () => {
    expect(drawer).toMatch(/text-muted-foreground">\s*<span aria-hidden className="[^"]*bg-\[var\(--fu-accent\)\]" \/>\s*Visible to the firm in the portal/);
  });

  it("no lime anywhere in the drawer files: no lime palette class, no app --primary", () => {
    for (const f of DRAWER_FILES) {
      const src = read(f);
      expect(src, f).not.toMatch(/\blime-\d{2,3}\b/);
      expect(src, f).not.toMatch(/\b(?:[a-z-]+:)*(?:bg|text|border|ring|outline|from|to)-primary\b/);
    }
  });

  it("every focus ring in the drawer is the calm admin green, not the app's lime --ring", () => {
    // Its own buttons use --fu-focus; its inputs use the shared ring-ring,
    // which .admin-ui (on the drawer's root) sets to the calm green.
    expect(drawer).toContain('import "@/app/admin/admin-theme.css"');
    expect(drawer).toMatch(/<div className="admin-ui fixed inset-0/);
    const rings = [...new Set(drawer.match(/focus-visible:ring-\[[^\]]+\]/g) ?? [])];
    expect(rings).toEqual(["focus-visible:ring-[var(--fu-focus)]"]);
  });
});

describe("the admin focus ring (admin-theme.css)", () => {
  const theme = read("src/app/admin/admin-theme.css");
  const ring = (sel: RegExp) => theme.match(sel)![1].match(/--ring:\s*([\d.]+) ([\d.]+)% ([\d.]+)%/)!.slice(1).map(Number);
  const LIGHT_RING = ring(/\n\.admin-ui \{([^}]*)\}/);
  const DARK_RING = ring(/\n\.dark \.admin-ui \{([^}]*)\}/);

  it("covers every admin page: the admin layout wraps them in .admin-ui", () => {
    const layout = read("src/app/admin/layout.tsx");
    expect(layout).toContain('import "./admin-theme.css"');
    expect(layout).toMatch(/<div className="admin-ui">\s*<AdminTabs \/>\s*\{children\}\s*<\/div>/);
  });

  it("is the firm green family, calmer: hue 160 (lime is 98), saturation 40% or less", () => {
    for (const [h, sat] of [LIGHT_RING, DARK_RING]) {
      expect(h).toBe(160);
      expect(sat).toBeLessThanOrEqual(40);
    }
  });

  it("matches the firm page's own focus token", () => {
    const hex = (t: number[]) => gTok(`--x: ${t[0]} ${t[1]}% ${t[2]}%`, "x");
    expect(hex(LIGHT_RING)).toBe(fuTok(FU_LIGHT, "focus").toLowerCase());
    expect(hex(DARK_RING)).toBe(fuTok(FU_DARK, "focus").toLowerCase());
  });
});

// ---------------------------------------------------------------------------
// Contrast on the drawer's own surface (bg-card), both themes
// ---------------------------------------------------------------------------

const fu = read("src/app/admin/firms/[id]/firm-page.css");
const FU_LIGHT = fu.match(/\n\.firm-ui \{([^}]*)\}/)?.[1] ?? "";
const FU_DARK = fu.match(/\n\.dark \.firm-ui \{([^}]*)\}/)?.[1] ?? "";
const fuTok = (b: string, name: string) => b.match(new RegExp(`--fu-${name}:\\s*(#[0-9a-f]{6})`, "i"))![1];

const globals = read("src/app/globals.css");
const G_LIGHT = globals.match(/:root \{([^}]*)\}/)?.[1] ?? "";
const G_DARK = globals.match(/\.dark \{([^}]*)\}/)?.[1] ?? "";
/** An HSL-triplet token from globals.css, as hex. */
function gTok(b: string, name: string): string {
  const [h, s, l] = b.match(new RegExp(`--${name}:\\s*([\\d.]+) ([\\d.]+)% ([\\d.]+)%`))!.slice(1).map(Number);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

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

describe.each([
  ["light", FU_LIGHT, G_LIGHT],
  ["dark", FU_DARK, G_DARK],
])("%s: AA on the drawer card", (_theme, F, G) => {
  const card = gTok(G, "card");

  it("the grey note label and current-value lines", () => {
    expect(contrast(gTok(G, "muted-foreground"), card)).toBeGreaterThanOrEqual(4.5);
  });

  it("the green dot and the button focus ring (non-text, 3:1)", () => {
    expect(contrast(fuTok(F, "accent"), card)).toBeGreaterThanOrEqual(3);
    expect(contrast(fuTok(F, "focus"), card)).toBeGreaterThanOrEqual(3);
  });

  it("the enabled Save: white label on the solid fill, at rest and on hover", () => {
    expect(contrast("#ffffff", fuTok(F, "solid"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff", fuTok(F, "solid-hover"))).toBeGreaterThanOrEqual(4.5);
  });

  it("the Revert link (foreground text)", () => {
    expect(contrast(gTok(G, "foreground"), card)).toBeGreaterThanOrEqual(4.5);
  });
});
