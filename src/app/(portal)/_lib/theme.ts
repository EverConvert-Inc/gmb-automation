// The portal's own light/dark theme. Deliberately NOT next-themes: that one
// is the internal app's, it writes the class on <html> and its choice to the
// "theme" key, and a second next-themes provider nested inside the first is
// ignored by the library. Everything here is scoped to the portal's root
// element and its own storage key, so the two can never affect each other.

export const PORTAL_THEME_KEY = "portal-theme";
export const PORTAL_ROOT_ID = "portal-root";

export type PortalTheme = "light" | "dark";
export const DEFAULT_PORTAL_THEME: PortalTheme = "light";

type ReadableStorage = { getItem(key: string): string | null };
type WritableStorage = { setItem(key: string, value: string): void };
type ThemeTarget = {
  classList: { contains(c: string): boolean; toggle(c: string, force: boolean): unknown };
  style: { colorScheme: string };
};

/** The saved choice, or light. Never throws — blocked storage means light. */
export function readPortalTheme(storage: ReadableStorage | null | undefined): PortalTheme {
  try {
    return storage?.getItem(PORTAL_THEME_KEY) === "dark" ? "dark" : DEFAULT_PORTAL_THEME;
  } catch {
    return DEFAULT_PORTAL_THEME;
  }
}

/** Saves the choice. Returns false (and the theme still applies) if storage refuses. */
export function savePortalTheme(storage: WritableStorage | null | undefined, theme: PortalTheme): boolean {
  try {
    if (!storage) return false;
    storage.setItem(PORTAL_THEME_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

export function currentPortalTheme(root: ThemeTarget | null): PortalTheme {
  return root?.classList.contains("dark") ? "dark" : "light";
}

export function applyPortalTheme(root: ThemeTarget | null, theme: PortalTheme): void {
  if (!root) return;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

/** Flips the theme on the portal root, saves it, and returns the new one. */
export function togglePortalTheme(
  root: ThemeTarget | null,
  storage: WritableStorage | null | undefined,
): PortalTheme {
  const next: PortalTheme = currentPortalTheme(root) === "dark" ? "light" : "dark";
  applyPortalTheme(root, next);
  savePortalTheme(storage, next);
  return next;
}

/**
 * Runs inline, right after the portal root's opening tag and before anything
 * inside it is parsed, so the saved theme is on the element before the first
 * paint. The same logic as readPortalTheme + applyPortalTheme, as a string.
 * Touches only the portal root — never <html> and never the "theme" key.
 */
export const PORTAL_THEME_SCRIPT = `(function(){var t=${JSON.stringify(DEFAULT_PORTAL_THEME)};try{if(window.localStorage.getItem(${JSON.stringify(
  PORTAL_THEME_KEY,
)})==="dark")t="dark"}catch(e){}var r=document.getElementById(${JSON.stringify(
  PORTAL_ROOT_ID,
)});if(r){r.classList.toggle("dark",t==="dark");r.style.colorScheme=t}})();`;
