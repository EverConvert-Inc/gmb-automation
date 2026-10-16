import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PortalLoadingOverlay, PortalSpinner } from "@/app/(portal)/_components/loader";
import PortalLoading from "@/app/(portal)/loading";

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("PortalSpinner", () => {
  const html = render(createElement(PortalSpinner, { size: 20 }));

  it("is a stroke-only 24×24 SVG that rotates as a whole", () => {
    expect(html).toMatch(/^<svg viewBox="0 0 24 24" width="20" height="20" fill="none" class="portal-loader/);
    expect(html.match(/<g /g)).toHaveLength(2);
    expect(html).not.toMatch(/<animate|<g[^>]*class=/); // nothing rotates on its own
  });

  it("draws two arcs on the radius-7 circle, each ending in a two-segment hook, with no markers or gradients", () => {
    expect(html).toContain('<path d="M5.42 9.61A7 7 0 0 1 18.58 9.61"');
    expect(html).toContain('<path d="M18.58 14.39A7 7 0 0 1 5.42 14.39"');
    expect(html).toContain('<polyline points="18.58 6.61 18.58 9.61 15.58 9.61"');
    expect(html).toContain('<polyline points="5.42 17.39 5.42 14.39 8.42 14.39"');
    expect(html).not.toMatch(/marker|Gradient|url\(/);
  });

  it("strokes are 1.8 wide with round caps and joins, one solid colour per arrow", () => {
    expect(html.match(/stroke-width="1.8"/g)).toHaveLength(2);
    expect(html.match(/stroke-linecap="round"/g)).toHaveLength(2);
    expect(html.match(/stroke-linejoin="round"/g)).toHaveLength(2);
    expect(html).toContain("stroke:var(--portal-loader-accent)");
    expect(html).toContain("stroke:var(--portal-loader-second)");
  });

  it("announces itself, unless decorative inside a button", () => {
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading"');
    const quiet = render(createElement(PortalSpinner, { decorative: true }));
    expect(quiet).toContain('aria-hidden="true"');
    expect(quiet).not.toContain('role="status"');
  });

  it("an arrow's colour can be swapped, e.g. to match a button background", () => {
    const swapped = render(createElement(PortalSpinner, { second: "#6fb744" }));
    expect(swapped).toContain("stroke:#6fb744");
    expect(swapped).not.toContain("--portal-loader-second");
  });
});

describe("on the green buttons", () => {
  it("Save and Sign in swap the green arrow so it doesn't vanish into the button", () => {
    for (const f of ["lead-note.tsx", "login-form.tsx"]) {
      const src = readFileSync(join(process.cwd(), "src", "app", "(portal)", "_components", f), "utf8");
      expect(src, f).toMatch(/<PortalSpinner[^>]*accent="hsl\(var\(--primary-foreground\)\)"[^>]*second="#ffffff"/);
    }
  });
});

describe("the full-page overlay", () => {
  it("is a fixed, full-screen, centred layer: page colour at 40%, 12px blur, 44px spinner", () => {
    const html = render(createElement(PortalLoadingOverlay));
    expect(html).toMatch(/class="fixed inset-0 z-50 flex items-center justify-center bg-background\/40 backdrop-blur-md"/);
    expect(html).toContain('width="44" height="44"');
  });

  it("is what the portal's loading.tsx shows", () => {
    expect(render(createElement(PortalLoading))).toContain("backdrop-blur-md");
  });
});

describe("styling", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "(portal)", "portal-theme.css"), "utf8");

  it("spins at 1.4s, around its centre, slower (3.2s) with reduced motion", () => {
    expect(css).toMatch(/@keyframes portal-loader-spin\s*\{\s*to\s*\{\s*transform:\s*rotate\(360deg\);\s*\}/);
    expect(css).toMatch(/animation:\s*portal-loader-spin 1\.4s linear infinite/);
    expect(css).toMatch(/transform-origin:\s*center/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.portal-theme \.portal-loader\s*\{\s*animation-duration:\s*3\.2s/);
  });

  it("the second arrow is white on dark, and not white on light (where it would vanish)", () => {
    expect(css).toMatch(/\.portal-theme\.dark\s*\{[^}]*--portal-loader-second:\s*#ffffff/);
    expect(css).toMatch(/\.portal-theme\s*\{[^}]*--portal-loader-second:\s*#1f2937/);
    // The accent is the brand green (the theme's primary), in both modes.
    expect(css.match(/--portal-loader-accent:\s*hsl\(var\(--primary\)\)/g)).toHaveLength(2);
    expect(css).not.toMatch(/#2563eb/i);
  });

  it("no portal file still uses the old lucide spinner", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? files(p) : [p];
      });
    for (const f of files(join(process.cwd(), "src", "app", "(portal)")).filter((f) => /\.tsx?$/.test(f))) {
      expect(readFileSync(f, "utf8"), f).not.toContain("LoaderCircle");
    }
  });
});
