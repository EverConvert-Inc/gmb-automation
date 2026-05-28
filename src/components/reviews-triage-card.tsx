"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Percent,
  Star,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";
import { StatTile } from "@/components/ui/stat-tile";
import { SyncReviewsButton } from "@/components/sync-reviews-button";
import { formatRelativeDate } from "@/lib/utils";

type Review = {
  id: string;
  rating: number;
  text: string | null;
  reviewerName: string | null;
  createdAt: Date;
  replyText: string | null;
  repliedAt: Date | null;
};

type SortKey = "attention" | "newest" | "oldest" | "lowest" | "highest";
type RatingFilter = "all" | 1 | 2 | 3 | 4 | 5;
type StatusFilter = "all" | "replied" | "unreplied";

const PAGE_SIZE = 10;

export function ReviewsTriageCard({
  reviews,
  locationId,
  hasGbpConnected,
}: {
  reviews: Review[];
  locationId: string;
  hasGbpConnected: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("attention");
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);

  const stats = useMemo(() => {
    const unreplied = reviews.filter((r) => r.replyText == null);
    const lowStarUnreplied = unreplied.filter((r) => r.rating <= 3);
    const replyRate =
      reviews.length === 0
        ? null
        : (reviews.length - unreplied.length) / reviews.length;
    return {
      total: reviews.length,
      unrepliedCount: unreplied.length,
      lowStarUnrepliedCount: lowStarUnreplied.length,
      replyRate,
    };
  }, [reviews]);

  const filtered = useMemo(() => {
    let out = reviews;
    if (ratingFilter !== "all") {
      out = out.filter((r) => r.rating === ratingFilter);
    }
    if (statusFilter === "replied") {
      out = out.filter((r) => r.replyText != null);
    } else if (statusFilter === "unreplied") {
      out = out.filter((r) => r.replyText == null);
    }
    const sorted = [...out];
    switch (sortKey) {
      case "attention":
        sorted.sort((a, b) => {
          // Unreplied first, then lowest rating, then newest within band.
          const aUnr = a.replyText == null ? 1 : 0;
          const bUnr = b.replyText == null ? 1 : 0;
          if (aUnr !== bUnr) return bUnr - aUnr;
          if (a.rating !== b.rating) return a.rating - b.rating;
          return b.createdAt.getTime() - a.createdAt.getTime();
        });
        break;
      case "newest":
        sorted.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        break;
      case "oldest":
        sorted.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        break;
      case "lowest":
        sorted.sort(
          (a, b) =>
            a.rating - b.rating ||
            b.createdAt.getTime() - a.createdAt.getTime(),
        );
        break;
      case "highest":
        sorted.sort(
          (a, b) =>
            b.rating - a.rating ||
            b.createdAt.getTime() - a.createdAt.getTime(),
        );
        break;
    }
    return sorted;
  }, [reviews, sortKey, ratingFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(
    currentPage * PAGE_SIZE,
    currentPage * PAGE_SIZE + PAGE_SIZE,
  );

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (reviews.length === 0) {
    return (
      <SectionCard
        id="reviews"
        icon={<MessageSquare className="h-4 w-4" />}
        title="Reviews"
        eyebrow="Reputation triage"
      >
        <div className="space-y-3 py-6 text-center text-sm text-muted-foreground">
          <p>No reviews yet for this location.</p>
          {!hasGbpConnected && (
            <Link
              href={`/api/oauth/google/start?locationId=${locationId}`}
              className={buttonClasses("outline", "sm")}
            >
              Connect Google Business Profile to sync reviews
            </Link>
          )}
          {hasGbpConnected && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-xs">
                Reviews sync automatically every day. Use the button below to
                pull them now.
              </p>
              <SyncReviewsButton locationId={locationId} />
            </div>
          )}
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      id="reviews"
      icon={<MessageSquare className="h-4 w-4" />}
      title="Reviews"
      eyebrow="Reputation triage"
      actions={hasGbpConnected ? <SyncReviewsButton locationId={locationId} /> : null}
      contentClassName="space-y-4 p-5"
    >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Total"
            value={String(stats.total)}
            icon={<MessageSquare className="h-4 w-4" />}
          />
          <StatTile
            label="Unreplied"
            value={String(stats.unrepliedCount)}
            tone={stats.unrepliedCount > 0 ? "amber" : "default"}
            icon={<AlertTriangle className="h-4 w-4" />}
          />
          <StatTile
            label="Needs attention"
            sublabel="≤3★ unreplied"
            value={String(stats.lowStarUnrepliedCount)}
            tone={stats.lowStarUnrepliedCount > 0 ? "red" : "default"}
            icon={<AlertTriangle className="h-4 w-4" />}
          />
          <StatTile
            label="Reply rate"
            value={
              stats.replyRate == null
                ? "—"
                : `${Math.round(stats.replyRate * 100)}%`
            }
            tone="brand"
            icon={
              stats.replyRate === 1 ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Percent className="h-4 w-4" />
              )
            }
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
          <SegmentedFilter
            label="Rating"
            value={ratingFilter}
            onChange={(v) => {
              setRatingFilter(v);
              setPage(0);
            }}
            options={[
              { value: "all", label: "All" },
              { value: 5, label: "5★" },
              { value: 4, label: "4★" },
              { value: 3, label: "3★" },
              { value: 2, label: "2★" },
              { value: 1, label: "1★" },
            ]}
          />
          <SegmentedFilter
            label="Status"
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v);
              setPage(0);
            }}
            options={[
              { value: "all", label: "All" },
              { value: "unreplied", label: "Unreplied" },
              { value: "replied", label: "Replied" },
            ]}
          />
          <div className="ml-auto inline-flex items-center gap-2">
            <span className="text-muted-foreground">Sort:</span>
            <select
              className="rounded-md border bg-background px-2 py-1 text-xs"
              value={sortKey}
              onChange={(e) => {
                setSortKey(e.target.value as SortKey);
                setPage(0);
              }}
            >
              <option value="attention">Needs attention</option>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="lowest">Lowest rating</option>
              <option value="highest">Highest rating</option>
            </select>
          </div>
        </div>

        <div className="hidden overflow-hidden rounded-md border sm:block">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-24 px-3 py-2 font-medium">Rating</th>
                <th className="px-3 py-2 font-medium">Reviewer</th>
                <th className="px-3 py-2 font-medium">Review</th>
                <th className="w-28 px-3 py-2 font-medium">Date</th>
                <th className="w-24 px-3 py-2 font-medium">Reply</th>
                <th className="w-8 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-6 text-center text-xs text-muted-foreground"
                  >
                    No reviews match the current filters.
                  </td>
                </tr>
              )}
              {pageRows.map((r) => {
                const isExpanded = expanded.has(r.id);
                const isReplied = r.replyText != null;
                return (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
                    onClick={() => toggleExpand(r.id)}
                  >
                    <td className="px-3 py-2 align-top">
                      <Stars rating={r.rating} />
                    </td>
                    <td className="px-3 py-2 align-top font-medium">
                      {r.reviewerName ?? "Anonymous"}
                    </td>
                    <td className="px-3 py-2 align-top text-muted-foreground">
                      <div className={isExpanded ? "" : "line-clamp-1"}>
                        {r.text ?? (
                          <em className="italic text-muted-foreground/70">
                            No text
                          </em>
                        )}
                      </div>
                      {isExpanded && isReplied && (
                        <div className="mt-2 rounded-md border-l-2 border-brand bg-muted/30 p-2 text-xs">
                          <div className="mb-0.5 font-semibold text-brand">
                            Owner reply
                            {r.repliedAt &&
                              ` · ${formatRelativeDate(r.repliedAt)}`}
                          </div>
                          <div className="whitespace-pre-wrap text-foreground">
                            {r.replyText}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 align-top text-xs text-muted-foreground">
                      {formatRelativeDate(r.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 align-top">
                      {isReplied ? (
                        <Badge variant="success">Replied</Badge>
                      ) : (
                        <Badge
                          variant={r.rating <= 3 ? "destructive" : "warning"}
                        >
                          No reply
                        </Badge>
                      )}
                    </td>
                    <td className="px-2 py-2 align-top text-muted-foreground">
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="space-y-2 sm:hidden">
          {pageRows.length === 0 && (
            <div className="rounded-md border bg-background p-3 text-center text-xs text-muted-foreground">
              No reviews match the current filters.
            </div>
          )}
          {pageRows.map((r) => {
            const isExpanded = expanded.has(r.id);
            const isReplied = r.replyText != null;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => toggleExpand(r.id)}
                className="block w-full rounded-md border bg-background p-3 text-left text-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {r.reviewerName ?? "Anonymous"}
                    </div>
                    <Stars rating={r.rating} />
                  </div>
                  <div className="text-right">
                    {isReplied ? (
                      <Badge variant="success">Replied</Badge>
                    ) : (
                      <Badge
                        variant={r.rating <= 3 ? "destructive" : "warning"}
                      >
                        No reply
                      </Badge>
                    )}
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {formatRelativeDate(r.createdAt)}
                    </div>
                  </div>
                </div>
                {r.text && (
                  <p
                    className={`mt-2 text-xs text-muted-foreground ${
                      isExpanded ? "" : "line-clamp-2"
                    }`}
                  >
                    {r.text}
                  </p>
                )}
                {isExpanded && isReplied && (
                  <div className="mt-2 rounded-md border-l-2 border-brand bg-muted/30 p-2 text-xs">
                    <div className="mb-0.5 font-semibold text-brand">
                      Owner reply
                      {r.repliedAt && ` · ${formatRelativeDate(r.repliedAt)}`}
                    </div>
                    <div className="whitespace-pre-wrap text-foreground">
                      {r.replyText}
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <div>
              {currentPage * PAGE_SIZE + 1}–
              {Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} of{" "}
              {filtered.length}
            </div>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages - 1}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        )}
    </SectionCard>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <div className="inline-flex items-center gap-0.5" aria-label={`${rating} stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={`h-3 w-3 ${
            i < rating
              ? "fill-amber-400 text-amber-400"
              : "text-muted-foreground/30"
          }`}
        />
      ))}
    </div>
  );
}

function SegmentedFilter<T extends string | number>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="inline-flex items-center gap-1">
      <span className="text-muted-foreground">{label}:</span>
      <div className="inline-flex rounded-md border">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(o.value)}
            className={`px-2 py-1 text-xs first:rounded-l-md last:rounded-r-md ${
              value === o.value
                ? "bg-foreground text-background"
                : "hover:bg-muted/40"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
