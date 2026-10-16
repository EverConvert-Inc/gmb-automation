// What a portal activity event may contain. Every metadata value is an enum,
// a small count or an Auth-issued timestamp — never note text, names, phone
// numbers, emails, search terms, hand-typed dates, IPs or user agents. The
// schemas are .strict(), so an extra key (a search term, a firm id) makes
// the whole event invalid rather than being stored.

import { z } from "zod";

export const PORTAL_EVENT_TYPES = [
  "sign_in",
  "page_view",
  "note_saved",
  "date_range_changed",
  "status_filter_used",
  "search_used",
] as const;
export type PortalEventType = (typeof PORTAL_EVENT_TYPES)[number];

/** The only events a browser may report. The rest are recorded by the server. */
export const BROWSER_EVENT_TYPES = ["date_range_changed", "status_filter_used", "search_used"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Supabase's last_sign_in_at, e.g. 2026-10-15T14:03:22.123456Z.
const AUTH_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

const STATUS = z.enum(["signed", "pending", "opportunity"]);

const dateRangeChanged = z
  .object({
    type: z.literal("date_range_changed"),
    // A preset is just its name; a custom range is just its length in days.
    // Never the dates.
    meta: z.union([
      z.object({ kind: z.enum(["preset_current", "preset_previous"]) }).strict(),
      z.object({ kind: z.literal("custom"), span_days: z.number().int().min(1).max(62) }).strict(),
    ]),
  })
  .strict();

const statusFilterUsed = z
  .object({
    type: z.literal("status_filter_used"),
    meta: z
      .object({
        statuses: z
          .array(STATUS)
          .max(3)
          .refine((xs) => new Set(xs).size === xs.length, "duplicate status"),
      })
      .strict(),
  })
  .strict();

const searchUsed = z
  .object({
    type: z.literal("search_used"),
    meta: z.object({ kind: z.enum(["name", "phone"]) }).strict(),
  })
  .strict();

/** A single event as a browser may send it. */
export const BrowserEventSchema = z.discriminatedUnion("type", [dateRangeChanged, statusFilterUsed, searchUsed]);
export type BrowserEvent = z.infer<typeof BrowserEventSchema>;

export const MAX_BROWSER_EVENTS_PER_REQUEST = 10;

/** The browser route's whole body: exactly { events: [...] }. */
export const BrowserEventBatchSchema = z
  .object({ events: z.array(BrowserEventSchema).min(1).max(MAX_BROWSER_EVENTS_PER_REQUEST) })
  .strict();

/** Every event the writer accepts, server-recorded ones included. */
export const PortalEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("sign_in"),
      meta: z.object({ signed_in_at: z.string().regex(AUTH_TIMESTAMP) }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("page_view"),
      meta: z
        .object({
          page: z.literal("leads"),
          range: z.enum(["current", "previous", "custom", "refused"]),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("note_saved"),
      leadId: z.string().regex(UUID),
      meta: z.object({}).strict(),
    })
    .strict(),
  dateRangeChanged,
  statusFilterUsed,
  searchUsed,
]);
export type PortalEventInput = z.infer<typeof PortalEventSchema>;
