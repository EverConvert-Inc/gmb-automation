import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * The EverConvert wordmark for the portal's own pages (sign-in, no access).
 * Both images are in the markup; portal-theme.css shows the green-and-black
 * one by default and swaps to the white-lettered one under the PORTAL's dark
 * class (set on its root before first paint), so the right logo is there from
 * the first paint. Never Tailwind's dark variant — that also follows the
 * internal app's setting on <html>. Same files as the internal sidebar
 * (src/components/brand-mark.tsx), same 7.8125:1 aspect, so one height fits
 * both.
 */
export function PortalLogo({ className }: { className?: string }) {
  return (
    <>
      <Image
        src="/everconvert-logo-green-black.png"
        alt="EverConvert"
        width={4000}
        height={512}
        priority
        className={cn("portal-logo-light h-8 w-auto", className)}
      />
      <Image
        src="/ec-logo.png"
        alt="EverConvert"
        width={500}
        height={64}
        priority
        className={cn("portal-logo-dark h-8 w-auto", className)}
      />
    </>
  );
}
