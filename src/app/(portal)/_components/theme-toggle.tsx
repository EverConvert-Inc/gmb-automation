"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
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

/**
 * The portal's light/dark switch, as a row in the user menu. Independent of
 * the internal app's toggle (see _lib/theme.ts).
 */
export function PortalThemeToggle({ className }: { className?: string }) {
  // Unknown until mounted: the server cannot know the saved choice.
  const [theme, setTheme] = useState<PortalTheme | null>(null);
  useEffect(() => setTheme(currentPortalTheme(portalRoot())), []);

  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(togglePortalTheme(portalRoot(), portalStorage()))}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className={cn(className)}
    >
      {isDark ? <Sun aria-hidden className="h-4 w-4" /> : <Moon aria-hidden className="h-4 w-4" />}
      <span>{isDark ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}
