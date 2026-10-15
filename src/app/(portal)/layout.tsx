import type { Metadata } from "next";
import "./portal-theme.css";
import { PORTAL_ROOT_ID, PORTAL_THEME_SCRIPT } from "./_lib/theme";

// Overrides the internal app's title and description: nothing about the
// internal platform should reach a client's browser tab.
export const metadata: Metadata = {
  title: { default: "Client portal", template: "%s · Client portal" },
  description: "Your firm's leads.",
};

/**
 * No data here, on purpose: an error thrown in a layout skips its own
 * segment's error page and lands on the internal app's root error page, which
 * prints error details. Everything that can fail sits below, under
 * (portal)/error.tsx.
 *
 * Covers the viewport so the internal app's shell never shows around it.
 * Light by default; the inline script applies a saved dark choice to THIS
 * element before first paint (see _lib/theme.ts). suppressHydrationWarning
 * because that script may add "dark" to the class before React hydrates.
 */
export default function PortalRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      id={PORTAL_ROOT_ID}
      className="portal-theme fixed inset-0 z-40 overflow-y-auto bg-background text-foreground antialiased"
      style={{ colorScheme: "light" }}
      suppressHydrationWarning
    >
      <script dangerouslySetInnerHTML={{ __html: PORTAL_THEME_SCRIPT }} />
      {children}
    </div>
  );
}
