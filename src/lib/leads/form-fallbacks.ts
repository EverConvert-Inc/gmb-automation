// Name/phone fallbacks, kept separate from parse-note.ts on purpose.
//
// The note is always tried first — for calls AND for form submissions, which
// go through the same parser. These fallbacks only fill what the note did
// not yield. Pure: no DB, no network, no imports.
//
// UNVERIFIED: the form_submissions field names below come from the dashboard
// automation's own request, not from a live response in this account. They
// must be checked against a real CallRail form submission on preview before
// Phase 3 relies on them. CallRail rejects an entire request on an unknown
// field name, so a wrong name here is a hard failure, not a silent null.
export const FORM_NAME_FIELDS = ["name", "full_name"] as const;
export const FORM_PHONE_FIELDS = ["phone", "phone_number"] as const;

export type FormSubmissionFallbackSource = {
  /** CallRail's top-level customer_name. */
  customerName?: string | null;
  /** CallRail's top-level customer_phone_number — also a call's caller ID. */
  customerPhoneNumber?: string | null;
  /** The form's own payload. Shape is per-form, so values are unknown. */
  formData?: Record<string, unknown> | null;
};

export type ResolvedContact = {
  name: string | null;
  phone: string | null;
  /** Where each value actually came from, for the admin queue. */
  nameSource: ContactSource;
  phoneSource: ContactSource;
};

export type ContactSource =
  | "note"
  | "customer_name"
  | "customer_phone_number"
  | "form_data"
  | "none";

function firstNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t : null;
}

function readFormField(
  formData: Record<string, unknown> | null | undefined,
  fields: readonly string[],
): string | null {
  if (!formData) return null;
  for (const field of fields) {
    const v = firstNonEmptyString(formData[field]);
    if (v) return v;
  }
  return null;
}

/**
 * Resolution order, per spec:
 *   name  — note, then customer_name, then form_data.name / full_name
 *   phone — note, then customer_phone_number, then form_data.phone /
 *           phone_number
 *
 * Name and phone are resolved INDEPENDENTLY: a note that yielded a name but
 * no phone keeps its name and takes the phone from the fallbacks, rather
 * than discarding both and falling back wholesale.
 */
export function resolveContact(
  fromNote: { name: string | null; phone: string | null },
  source: FormSubmissionFallbackSource,
): ResolvedContact {
  const noteName = firstNonEmptyString(fromNote.name);
  const notePhone = firstNonEmptyString(fromNote.phone);

  let name = noteName;
  let nameSource: ContactSource = name ? "note" : "none";
  if (!name) {
    const customer = firstNonEmptyString(source.customerName);
    if (customer) {
      name = customer;
      nameSource = "customer_name";
    } else {
      const fromForm = readFormField(source.formData, FORM_NAME_FIELDS);
      if (fromForm) {
        name = fromForm;
        nameSource = "form_data";
      }
    }
  }

  let phone = notePhone;
  let phoneSource: ContactSource = phone ? "note" : "none";
  if (!phone) {
    const customer = firstNonEmptyString(source.customerPhoneNumber);
    if (customer) {
      phone = customer;
      phoneSource = "customer_phone_number";
    } else {
      const fromForm = readFormField(source.formData, FORM_PHONE_FIELDS);
      if (fromForm) {
        phone = fromForm;
        phoneSource = "form_data";
      }
    }
  }

  return { name, phone, nameSource, phoneSource };
}
