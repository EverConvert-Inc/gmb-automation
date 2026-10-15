"use client";

import { useEffect, useId, useRef, useState } from "react";
import { User } from "lucide-react";
import { cn } from "@/lib/utils";
import { PortalSignOutButton } from "./sign-out-button";
import { PortalThemeToggle } from "./theme-toggle";
import { portalFocus } from "./ui";

const ROW =
  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-50";

/**
 * The avatar button and its dropdown: who is signed in, the theme toggle,
 * and sign out. A disclosure (button + panel), not an ARIA menu, so plain
 * Tab/Shift-Tab move through it; Escape closes and returns focus to the
 * button, as does clicking or tabbing away. The panel is always in the
 * markup and `hidden` while closed, so a closed menu is invisible to screen
 * readers too.
 */
export function PortalUserMenu({ email }: { email: string | null }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const initial = email?.trim()[0]?.toUpperCase() ?? null;

  return (
    <div
      ref={wrapRef}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
      onBlur={(e) => {
        if (open && !wrapRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label="Open user menu"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-shadow hover:ring-4 hover:ring-primary/20",
          portalFocus,
        )}
      >
        {initial ?? <User aria-hidden className="h-4 w-4" />}
      </button>

      <div
        ref={panelRef}
        id={panelId}
        hidden={!open}
        className="absolute right-0 top-full z-20 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-xl border bg-card p-1.5 shadow-lg"
      >
        <div className="px-2.5 pb-2 pt-1.5">
          <p className="text-xs font-medium text-muted-foreground">Signed in as</p>
          <p className="truncate text-sm font-medium text-foreground" title={email ?? undefined}>
            {email ?? "Unknown user"}
          </p>
        </div>
        <div className="my-1 border-t" />
        <PortalThemeToggle className={ROW} />
        <PortalSignOutButton className={ROW} />
      </div>
    </div>
  );
}
