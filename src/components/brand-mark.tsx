import Image from "next/image";
import { cn } from "@/lib/utils";

// Renders the EverConvert wordmark. The source PNG sits at /public/ec-logo.png
// (500×64, transparent background, green letters + arrow icon) so it composites
// cleanly onto the dark sidebar and white pages alike.
export function BrandMark({ className }: { className?: string }) {
  return (
    <Image
      src="/ec-logo.png"
      alt="EverConvert"
      width={500}
      height={64}
      priority
      className={cn("h-7 w-auto", className)}
    />
  );
}
