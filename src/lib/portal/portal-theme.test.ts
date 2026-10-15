// The portal's light/dark theme: light by default, toggled and saved under
// the portal's OWN key, applied before first paint, and never reaching the
// internal app's theme (its <html> class or its "theme" storage key).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import PortalRootLayout from "@/app/(portal)/layout";
import {
  DEFAULT_PORTAL_THEME,
  PORTAL_ROOT_ID,
  PORTAL_THEME_KEY,
  PORTAL_THEME_SCRIPT,
  readPortalTheme,
  togglePortalTheme,
} from "@/app/(portal)/_lib/theme";

const PORTAL_DIR = join(process.cwd(), "src", "app", "(portal)");

/** A localStorage stand-in. `blocked` makes every call throw, like Safari private mode. */
function fakeStorage(initial: Record<string, string> = {}, blocked = false) {
  const data = { ...initial };
  return {
    data,
    getItem(k: string) {
      if (blocked) throw new Error("SecurityError");
      return k in data ? data[k] : null;
    },
    setItem(k: string, v: string) {
      if (blocked) throw new Error("QuotaExceededError");
      data[k] = v;
    },
  };
}

/** The portal root element, as far as the theme code can see it. */
function fakeRoot() {
  const classes = new Set<string>(["portal-theme"]);
  return {
    classes,
    classList: {
      contains: (c: string) => classes.has(c),
      toggle: (c: string, force: boolean) => (force ? classes.add(c) : classes.delete(c)),
    },
    style: { colorScheme: "light" },
  };
}

/**
 * Runs the inline pre-paint script exactly as the browser would, against a
 * fake window/document. <html> is a trap: touching it fails the test.
 */
function runScript(storage: ReturnType<typeof fakeStorage> | { get localStorage(): never }) {
  const root = fakeRoot();
  const htmlTrap = new Proxy({}, { get: () => { throw new Error("the portal touched <html>"); } });
  const document = {
    getElementById: (id: string) => (id === PORTAL_ROOT_ID ? root : null),
    get documentElement() {
      return htmlTrap;
    },
  };
  const window = "getItem" in storage ? { localStorage: storage } : storage;
  new Function("window", "document", PORTAL_THEME_SCRIPT)(window, document);
  return root;
}

describe("default", () => {
  it("is light", () => {
    expect(DEFAULT_PORTAL_THEME).toBe("light");
    expect(readPortalTheme(fakeStorage())).toBe("light");
    const root = runScript(fakeStorage());
    expect(root.classes.has("dark")).toBe(false);
    expect(root.style.colorScheme).toBe("light");
  });

  it("the server-rendered portal root is light, with the pre-paint script inside it", () => {
    const html = renderToStaticMarkup(createElement(PortalRootLayout, null, createElement("p", null, "child")));
    const open = html.slice(0, html.indexOf(">") + 1);
    expect(open).toContain(`id="${PORTAL_ROOT_ID}"`);
    expect(open).toContain("portal-theme");
    expect(open).not.toMatch(/class="[^"]*\bdark\b/);
    expect(open).toContain("color-scheme:light");
    // The script comes BEFORE the content, so it runs before the content paints.
    expect(html.indexOf("<script>")).toBeLessThan(html.indexOf("child"));
    expect(html).toContain(PORTAL_THEME_KEY);
  });

  it("is light when storage is unavailable or holds junk", () => {
    expect(readPortalTheme(fakeStorage({}, true))).toBe("light");
    expect(readPortalTheme(null)).toBe("light");
    expect(readPortalTheme(fakeStorage({ [PORTAL_THEME_KEY]: "purple" }))).toBe("light");
    // window.localStorage itself throwing (blocked cookies).
    const root = runScript({ get localStorage(): never { throw new Error("SecurityError"); } });
    expect(root.classes.has("dark")).toBe(false);
  });
});

describe("toggle", () => {
  it("switches light → dark → light, saving each choice under the portal's key", () => {
    const root = fakeRoot();
    const storage = fakeStorage();
    expect(togglePortalTheme(root, storage)).toBe("dark");
    expect(root.classes.has("dark")).toBe(true);
    expect(root.style.colorScheme).toBe("dark");
    expect(storage.data[PORTAL_THEME_KEY]).toBe("dark");

    expect(togglePortalTheme(root, storage)).toBe("light");
    expect(root.classes.has("dark")).toBe(false);
    expect(storage.data[PORTAL_THEME_KEY]).toBe("light");
  });

  it("the saved choice is applied before first paint on the next load", () => {
    const storage = fakeStorage();
    togglePortalTheme(fakeRoot(), storage); // choose dark
    const reloaded = runScript(storage);
    expect(reloaded.classes.has("dark")).toBe(true);
    expect(reloaded.style.colorScheme).toBe("dark");
  });

  it("still switches for this visit when storage refuses to save", () => {
    const root = fakeRoot();
    expect(() => togglePortalTheme(root, fakeStorage({}, true))).not.toThrow();
    expect(root.classes.has("dark")).toBe(true);
    expect(togglePortalTheme(root, null)).toBe("light");
  });
});

describe("kept apart from the internal app's theme", () => {
  it("uses its own key, never next-themes' \"theme\"", () => {
    expect(PORTAL_THEME_KEY).not.toBe("theme");
    // The internal app saved dark; the portal still starts light…
    const storage = fakeStorage({ theme: "dark" });
    expect(runScript(storage).classes.has("dark")).toBe(false);
    // …and the portal's toggle leaves the internal choice alone.
    togglePortalTheme(fakeRoot(), storage);
    togglePortalTheme(fakeRoot(), storage);
    expect(storage.data.theme).toBe("dark");
  });

  it("the pre-paint script never touches <html>", () => {
    expect(() => runScript(fakeStorage({ [PORTAL_THEME_KEY]: "dark" }))).not.toThrow();
    expect(PORTAL_THEME_SCRIPT).not.toMatch(/documentElement|\.theme\b|"theme"/);
  });

  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : [p];
    });

  it("no portal file uses next-themes, <html>, or a Tailwind dark: variant (which <html>.dark would trigger)", () => {
    for (const f of files(PORTAL_DIR).filter((f) => /\.(tsx?|css)$/.test(f))) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/from\s+["']next-themes["']|\.documentElement/);
      expect(src, f).not.toMatch(/(^|[\s"'`])dark:/);
    }
  });

  it("every rule in portal-theme.css is scoped to the portal root", () => {
    const css = readFileSync(join(PORTAL_DIR, "portal-theme.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
    expect(selectors.length).toBeGreaterThan(5);
    for (const s of selectors) {
      for (const part of s.split(",")) expect(part.trim(), s).toMatch(/^\.portal-theme(\.dark)?(\s|$)/);
    }
  });
});
