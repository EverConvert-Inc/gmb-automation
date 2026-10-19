"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import "@/app/admin/firms/[id]/firm-page.css";
import "@/app/admin/admin-theme.css";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError, Input, Label, Textarea } from "@/components/ui/form";
import { AdminSelect } from "./admin-select";
import { formatEasternDateTime } from "@/lib/leads/admin-dates";
import type { AdminLeadRow } from "@/lib/leads/queries-admin";
import { cn } from "@/lib/utils";
import { sourceLabel } from "./source-label";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Save and Add note. Enabled: a solid firm-green fill with a white label, so
 * it reads as a live button in both themes. Disabled: plain muted grey, so
 * the two states never look alike (WCAG exempts disabled controls from the
 * contrast minimum).
 */
const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const ENABLED_BUTTON =
  "border-transparent bg-[var(--fu-solid)] text-white shadow-sm hover:bg-[var(--fu-solid-hover)]";
const DISABLED_BUTTON = "cursor-not-allowed border-transparent bg-muted text-muted-foreground/70";

function SaveButton({ disabled, className, type = "button", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={cn(BUTTON_BASE, disabled ? DISABLED_BUTTON : ENABLED_BUTTON, className)}
      {...props}
    />
  );
}

/**
 * The lead editor: a right-side drawer, a centred modal on small screens.
 * Every request it makes belongs to AdminLeadActions (onPatch / onAddNote),
 * unchanged from the inline editor it replaces.
 *
 * Escape, Close or the backdrop dismisses it. Focus moves into it on open,
 * Tab stays inside it, and focus goes back to the Edit button on close.
 */
export function AdminLeadDrawer({
  lead,
  busy,
  error,
  note,
  onNoteChange,
  onPatch,
  onAddNote,
  onClose,
  returnFocusTo,
}: {
  lead: AdminLeadRow;
  busy: boolean;
  error: string | null;
  note: string;
  onNoteChange: (v: string) => void;
  onPatch: (body: Record<string, unknown>) => void;
  onAddNote: (e: React.FormEvent) => void;
  onClose: () => void;
  returnFocusTo: RefObject<HTMLElement | null>;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const returnTo = returnFocusTo.current;
    closeButton.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = panel.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      returnTo?.focus();
    };
  }, [returnFocusTo]);

  const statusSource =
    lead.statusOverride !== null
      ? "set by staff"
      : lead.statusTagMatched
        ? `from tag “${lead.statusTagMatched}”`
        : "from tags";
  const opportunitySource = lead.isOpportunityOverride !== null ? "set by staff" : "from tags";

  return createPortal(
    <div className="admin-ui fixed inset-0 z-50 flex items-center justify-center p-4 md:items-stretch md:justify-end md:p-0">
      <div aria-hidden className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "firm-ui relative flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col rounded-xl border bg-card text-card-foreground shadow-xl",
          "md:h-full md:max-h-none md:max-w-lg md:rounded-none md:border-y-0 md:border-r-0",
        )}
      >
        <header className="flex items-start gap-3 border-b p-5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold leading-7">
              Edit lead
            </h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="tabular-nums">{formatEasternDateTime(lead.occurredAt)}</span>
              <Badge variant="outline" size="sm">
                {sourceLabel(lead.source)}
                {lead.personSuffix !== "p1" ? ` · ${lead.personSuffix}` : ""}
              </Badge>
              {lead.firmName ? <span className="truncate">{lead.firmName}</span> : null}
            </p>
          </div>
          <Button ref={closeButton} type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <X aria-hidden className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          <Field
            id={`status-${lead.id}`}
            label="Status"
            current={`Now ${capitalise(lead.status)} · ${statusSource}`}
          >
            <AdminSelect
              id={`status-${lead.id}`}
              defaultValue={lead.statusOverride ?? ""}
              disabled={busy}
              onChange={(e) =>
                onPatch({ statusOverride: e.target.value === "" ? null : e.target.value })
              }
            >
              {/* Clearing the override hands the lead back to its tags. */}
              <option value="">From tags ({lead.statusParsed})</option>
              <option value="pending">Pending</option>
              <option value="signed">Signed</option>
            </AdminSelect>
          </Field>

          <Field
            id={`opp-${lead.id}`}
            label="Opportunity"
            current={`Now ${lead.isOpportunity ? "Yes" : "No"} · ${opportunitySource}`}
          >
            <AdminSelect
              id={`opp-${lead.id}`}
              defaultValue={
                lead.isOpportunityOverride === null
                  ? ""
                  : lead.isOpportunityOverride
                    ? "yes"
                    : "no"
              }
              disabled={busy}
              onChange={(e) =>
                onPatch({
                  isOpportunityOverride:
                    e.target.value === "" ? null : e.target.value === "yes",
                })
              }
            >
              <option value="">
                From tags ({lead.isOpportunityParsed ? "yes" : "no"})
              </option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </AdminSelect>
          </Field>

          <OverrideField
            id={`name-${lead.id}`}
            label="Name"
            parsed={lead.nameParsed}
            value={lead.name}
            disabled={busy}
            onSave={(v) => onPatch({ nameOverride: v })}
          />
          <OverrideField
            id={`phone-${lead.id}`}
            label="Phone"
            parsed={lead.phoneParsed}
            value={lead.phone}
            disabled={busy}
            onSave={(v) => onPatch({ phoneOverride: v })}
          />

          <form onSubmit={onAddNote} className="space-y-2 border-t pt-6">
            <Label htmlFor={`note-${lead.id}`}>Add a staff note</Label>
            <p id={`note-hint-${lead.id}`} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--fu-accent)]" />
              Visible to the firm in the portal
            </p>
            <Textarea
              id={`note-${lead.id}`}
              rows={4}
              value={note}
              aria-describedby={`note-hint-${lead.id}`}
              onChange={(e) => onNoteChange(e.target.value)}
              placeholder="Visible to the firm in the portal."
            />
            <SaveButton type="submit" disabled={busy || !note.trim()}>
              {busy ? "Saving…" : "Add note"}
            </SaveButton>
          </form>

          <FormError>{error}</FormError>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Field({
  id,
  label,
  current,
  children,
}: {
  id: string;
  label: string;
  current: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      <p className="text-xs text-muted-foreground">{current}</p>
    </div>
  );
}

function OverrideField({
  id,
  label,
  parsed,
  value,
  disabled,
  onSave,
}: {
  id: string;
  label: string;
  parsed: string | null;
  value: string | null;
  disabled: boolean;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  // The row carries the effective value and the parsed one; they differ
  // only when staff saved an override (same test as the table's strike-through).
  const edited = value !== parsed;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          className="min-w-0 flex-1"
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={parsed ?? "—"}
        />
        <SaveButton disabled={disabled || draft === (value ?? "")} onClick={() => onSave(draft)}>
          Save
        </SaveButton>
      </div>
      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span>
          Now {value ?? "—"} · {edited ? "edited by staff" : "from CallRail"}
        </span>
        {/* Saving an empty value clears the override rather than storing a blank. */}
        {edited ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setDraft(parsed ?? "");
              onSave("");
            }}
            className="font-medium text-foreground underline underline-offset-2 hover:text-muted-foreground disabled:opacity-50"
          >
            Revert to {parsed ?? "nothing"}
          </button>
        ) : null}
      </p>
    </div>
  );
}
