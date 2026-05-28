"use client";

import { useTheme } from "next-themes";
import { Toaster as SonnerToaster } from "sonner";

// Thin wrapper around sonner's Toaster that mirrors the user's selected
// theme so toast surfaces match the rest of the dashboard instead of
// always rendering in light mode.
export function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <SonnerToaster
      position="bottom-right"
      richColors
      closeButton
      theme={(resolvedTheme as "light" | "dark") ?? "system"}
      toastOptions={{ duration: 5000 }}
    />
  );
}
