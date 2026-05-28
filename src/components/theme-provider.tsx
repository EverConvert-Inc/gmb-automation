"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

// next-themes adds `.dark` / `.light` to <html> based on user preference,
// stored in localStorage. `defaultTheme="system"` follows the OS preference
// on first visit; the toggle in the sidebar persists the user's pick.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
