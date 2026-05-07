import { Star } from "lucide-react";

export function StarBar({
  rating,
  reviewCount,
}: {
  rating: number | null;
  reviewCount?: number;
}) {
  if (rating === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  const full = Math.round(rating);
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={
            i <= full
              ? "h-4 w-4 fill-yellow-400 text-yellow-400"
              : "h-4 w-4 text-muted-foreground"
          }
        />
      ))}
      <span className="ml-1 text-sm font-medium">{rating.toFixed(1)}</span>
      {typeof reviewCount === "number" && (
        <span className="ml-1 text-sm text-muted-foreground">
          · {reviewCount} review{reviewCount === 1 ? "" : "s"}
        </span>
      )}
    </div>
  );
}
