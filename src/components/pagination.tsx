import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";

// Plain server-rendered pager — a real <a href> per page (not an onClick
// handler), matching PpcDateRangeFilter's convention: navigation works
// immediately via native browser nav, no hydration wait. Page 1 omits the
// query param so the base URL stays clean/shareable.
export function Pagination({
  page,
  totalPages,
  basePath,
}: {
  page: number;
  totalPages: number;
  basePath: string;
}) {
  if (totalPages <= 1) return null;

  function href(p: number): string {
    return p <= 1 ? basePath : `${basePath}?page=${p}`;
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">
        Page {page} of {totalPages}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={buttonClasses("outline", "sm")}>
            <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Prev
          </Link>
        ) : (
          <span
            aria-disabled
            className={buttonClasses("outline", "sm", "pointer-events-none opacity-50")}
          >
            <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Prev
          </span>
        )}
        {page < totalPages ? (
          <Link href={href(page + 1)} className={buttonClasses("outline", "sm")}>
            Next <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        ) : (
          <span
            aria-disabled
            className={buttonClasses("outline", "sm", "pointer-events-none opacity-50")}
          >
            Next <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </span>
        )}
      </div>
    </div>
  );
}
