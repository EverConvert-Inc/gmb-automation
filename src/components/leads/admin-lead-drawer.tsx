"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import "@/app/admin/firms/[id]/firm-page.css";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError, Input, Label, Textarea } from "@/components/ui/form";
import { AdminSelect } from "./admin-select";
import { formatEasternDateTime } from "@/lib/leads/admin-dates";
import type { AdminLeadRow } from "@/lib/leads/queries-admin";
import { cn } from "@/lib/utils";
import { firmButtonClasses } from "./firm-button";
import { fuFocusRing, fuGreenText } from "./firm-ui";
import { adminStatusView, fromTagsStatusText } from "./admin-status";
import { sourceLabel } from "./source-label";
import { adminClientVisibility, negativeTagNames } from "./admin-visibility";
import { CLIENT_LABEL_TEXT } from "@/lib/portal/visibility";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Save and Add note. Enabled: the firm page's primary button, unchanged.
 * Disabled: plain muted grey, not a faded green, so it never reads as
 * enabled-but-dim (WCAG exempts disabled controls from the contrast minimum).
 */
const DISABLED_BUTTON =
  "inline-flex cursor-not-allowed items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-transparent bg-muted px-4 py-2 text-sm font-medium text-muted-foreground/70";

function SaveButton({ disabled, className, type = "button", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={disabled ? cn(DISABLED_BUTTON, className) : firmButtonClasses("primary", className)}
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
  onApprove,
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
  /** "Approve for client" — AdminLeadActions posts to the approve route. */
  onApprove: () => void;
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

  const view = adminStatusView(lead);
  const statusSource =
    lead.statusOverride !== null
      ? "set by staff"
      : lead.statusTagMatched
        ? `from tag “${lead.statusTagMatched}”`
        : "from tags";
  // What the client sees, by the portal's own rule.
  const statusNow =
    view.kind === "negative"
      ? `Now ${view.tags} · hidden from client, needs review`
      : view.kind === "opportunity"
        ? "Now Opportunity · not shown to client"
        : view.kind === "review"
          ? `Now ${view.text} · under review`
          : `Now ${view.text} · ${statusSource}`;
  const opportunitySource = lead.isOpportunityOverride !== null ? "set by staff" : "from tags";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:items-stretch md:justify-end md:p-0">
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
          <ClientSection lead={lead} busy={busy} onApprove={onApprove} />
          <Field
            id={`status-${lead.id}`}
            label="Status"
            current={statusNow}
          >
            <AdminSelect
              className={fuFocusRing}
              id={`status-${lead.id}`}
              defaultValue={lead.statusOverride ?? ""}
              disabled={busy}
              onChange={(e) =>
                onPatch({ statusOverride: e.target.value === "" ? null : e.target.value })
              }
            >
              {/* Clearing the override hands the lead back to its tags. */}
              <option value="">From tags ({fromTagsStatusText(lead)})</option>
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
              className={fuFocusRing}
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
              className={fuFocusRing}
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
          className={cn("min-w-0 flex-1", fuFocusRing)}
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
            className={cn("font-medium underline-offset-2 hover:underline disabled:opacity-50", fuGreenText)}
          >
            Revert to {parsed ?? "nothing"}
          </button>
        ) : null}
      </p>
    </div>
  );
}


/**
 * What the client sees of this lead, and why — the portal's own rule
 * (clientVisibility). Held back for a negative tag or as Opportunity only,
 * it offers "Approve for client".
 */
function ClientSection({ lead, busy, onApprove }: { lead: AdminLeadRow; busy: boolean; onApprove: () => void }) {
  const v = adminClientVisibility(lead);
  let text: string;
  let canApprove = false;
  if (v.visible) {
    text = `Shown to the client as ${CLIENT_LABEL_TEXT[v.label]}`;
    if (v.approved && lead.clientApprovedAt) {
      text += ` · approved${lead.clientApprovedBy ? ` by ${lead.clientApprovedBy}` : ""} on ${formatEasternDateTime(lead.clientApprovedAt)}`;
    }
  } else if (v.reason === "negative_tag") {
    text = `Hidden from the client: negative tag (${negativeTagNames(v.negativeTags)}). Needs review.`;
    if (v.approvedEarlier) text += " An earlier approval does not cover every tag it carries now.";
    canApprove = true;
  } else if (v.reason === "opportunity_only") {
    text = "Not shown to the client: Opportunity only.";
    canApprove = true;
  } else {
    text = "Hidden from the client while it is under review.";
  }
  return (
    <section aria-label="Client visibility" className="space-y-2 rounded-lg border p-3">
      <p className="text-sm" data-client-visibility={v.visible ? "shown" : v.reason}>
        {text}
      </p>
      {canApprove ? (
        <SaveButton disabled={busy} onClick={onApprove}>
          Approve for client
        </SaveButton>
      ) : null}
    </section>
  );
}
