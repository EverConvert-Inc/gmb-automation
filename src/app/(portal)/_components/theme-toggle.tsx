"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import {
  PORTAL_ROOT_ID,
  currentPortalTheme,
  togglePortalTheme,
  type PortalTheme,
} from "../_lib/theme";

function portalRoot() {
  return typeof document === "undefined" ? null : document.getElementById(PORTAL_ROOT_ID);
}

function portalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // blocked storage: the toggle still works for this visit
  }
}

/** The portal's light/dark switch. Independent of the internal app's toggle. */
export function PortalThemeToggle() {
  // Unknown until mounted: the server cannot know the saved choice.
  const [theme, setTheme] = useState<PortalTheme | null>(null);
  useEffect(() => setTheme(currentPortalTheme(portalRoot())), []);

  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(togglePortalTheme(portalRoot(), portalStorage()))}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Light mode" : "Dark mode"}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {theme === null ? null : isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
