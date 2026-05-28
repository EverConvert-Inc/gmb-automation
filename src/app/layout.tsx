import type { Metadata } from "next";
import { Inter, Oxygen } from "next/font/google";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemedToaster } from "@/components/themed-toaster";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const display = Oxygen({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Local Visibility Platform",
    template: "%s · Local Visibility Platform",
  },
  description: "EverConvert local visibility platform — rank tracking, reviews, and GBP performance.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${display.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider>
          <AppShell>{children}</AppShell>
          <ThemedToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
