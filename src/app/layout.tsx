import type { Metadata } from "next";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Local Visibility Platform",
  description: "Internal GBP rank tracking and review dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <header className="border-b">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
            <Link href="/clients" className="text-sm font-semibold">
              Local Visibility Platform
            </Link>
            <nav className="flex items-center gap-4 text-sm text-muted-foreground">
              <Link href="/clients" className="hover:text-foreground">Clients</Link>
              <Link href="/scans" className="hover:text-foreground">Scans</Link>
              <Link href="/settings" className="hover:text-foreground">Settings</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
