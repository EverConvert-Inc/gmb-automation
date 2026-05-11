import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelativeDate(date: Date | string | null): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

// Minute-resolution relative time. Negative diffs (future) render as "in Xm".
export function formatRelativeTime(date: Date | string | null): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const diffSec = Math.round((Date.now() - d.getTime()) / 1000);
  const past = diffSec >= 0;
  const abs = Math.abs(diffSec);
  if (abs < 60) return past ? "just now" : "in <1m";
  const minutes = Math.floor(abs / 60);
  if (minutes < 60) return past ? `${minutes}m ago` : `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return past ? `${hours}h ago` : `in ${hours}h`;
  return formatRelativeDate(d);
}

export function recencyColor(daysSince: number | null): string {
  if (daysSince === null) return "text-muted-foreground";
  if (daysSince < 14) return "text-green-600";
  if (daysSince < 45) return "text-yellow-600";
  return "text-red-600";
}
