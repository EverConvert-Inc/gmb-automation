import type { Metadata } from "next";

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
 * Always dark, and covering the viewport, so the internal app's shell never
 * shows around it.
 */
export default function PortalRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="dark fixed inset-0 z-40 overflow-y-auto bg-background text-foreground antialiased"
      style={{ colorScheme: "dark" }}
    >
      {children}
    </div>
  );
}
