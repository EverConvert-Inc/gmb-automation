import Image from "next/image";
import { cn } from "@/lib/utils";

// The EverConvert wordmark, one image per theme:
// - light: /everconvert-logo-green-black.png (4000×512, green + black letters)
// - dark:  /ec-logo.png (500×64, green + white letters)
// Both are cropped tight to the letters at exactly the same aspect ratio
// (7.8125:1), so the same height gives the same size in either theme. Which
// one shows is decided by CSS (the .dark class next-themes puts on <html>),
// so the right logo is there from the first paint, with no flash.
export function BrandMark({ className }: { className?: string }) {
  return (
    <>
      <Image
        src="/everconvert-logo-green-black.png"
        alt="EverConvert"
        width={4000}
        height={512}
        priority
        className={cn("h-7 w-auto dark:hidden", className)}
      />
      <Image
        src="/ec-logo.png"
        alt="EverConvert"
        width={500}
        height={64}
        priority
        className={cn("hidden h-7 w-auto dark:block", className)}
      />
    </>
  );
}
