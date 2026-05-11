import { cn } from "@/lib/utils";

// Text-only brand wordmark. To use the real EverConvert logo:
//   1. Drop the WebP into /public/everconvert-logo.webp
//   2. Replace the inner JSX with:
//        <Image
//          src="/everconvert-logo.webp"
//          alt="EverConvert"
//          width={140}
//          height={28}
//          priority
//          className="h-7 w-auto"
//        />
//   The download was blocked by the sandbox network; no code change needed
//   beyond swapping in the asset.
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1 font-display text-base font-bold uppercase tracking-tight",
        className,
      )}
      aria-label="EverConvert"
    >
      <span className="text-brand-dark-foreground">Ever</span>
      <span className="text-brand">Convert</span>
    </span>
  );
}
