// Name/phone parsing for the client-facing lead tracker, ported from the
// dashboard automation's rules.
//
// Pure: no DB, no network, no imports. Everything a decision depends on is
// an argument. Deliberately knows nothing about status SEMANTICS — a
// multi-person note's per-person status is returned as raw text and resolved
// by status-from-tags.ts, so the ladder lives in exactly one place.
//
// The source of truth for a lead's name and phone is the CallRail NOTE.
// Caller ID is a fallback only, because the note is what a human typed after
// speaking to the person, while caller ID is whatever line they dialled from.

export type ParseFailureReason =
  | "empty_note"
  | "multiple_phone_numbers"
  | "name_contains_digits"
  | "no_name"
  | "person_missing_name_or_phone"
  | "declared_person_count_mismatch"
  | "unparseable";

export type ParsedPerson = {
  /** 'p1', 'p2', ... — the person_suffix half of the leads upsert key. */
  personSuffix: string;
  name: string;
  /** Kept exactly as written in the note. Null only via the name-only rule. */
  phone: string | null;
  /** Multi-person only: the third field, unresolved. Null for single-person. */
  statusText: string | null;
  /**
   * Single-person only: a status word that trailed the phone, stripped out
   * of the name. Informational — never overrides the tag-derived status.
   */
  noteStatus: string | null;
};

export type ParseNoteResult =
  | {
      ok: true;
      people: ParsedPerson[];
      isMultiPerson: boolean;
      sharedNote: string | null;
    }
  | {
      ok: false;
      reason: ParseFailureReason;
      /** Machine-readable context for the admin queue. Never client-visible. */
      detail: string | null;
      sharedNote: string | null;
    };

export type ParseNoteOptions = {
  /** CallRail tags on the lead — read only for an "N Person" declaration. */
  tags?: readonly (string | null | undefined)[] | null;
  /** customer_phone_number. The fallback for the name-only rule. */
  callerIdPhone?: string | null;
};

// --------------------------------------------------------------------------
// Phone numbers
// --------------------------------------------------------------------------

// US numbers: 10 digits, optional +1/1 country prefix, space/dot/dash
// separators, optional brackets around the area code, optional extension.
//
// The two lookarounds are the whole defence against the malformed digit-run
// case. Without (?<!\d) and (?!\d), a 14-digit run like an account number
// would yield a "phone" from its first 10 digits, and the leftover digits
// would then fail the name check for the wrong reason. With them, an
// over-long run matches nothing at all: every start offset inside the run is
// blocked by the lookbehind, and the only offset that passes it cannot
// satisfy the lookahead.
const PHONE_PATTERN = String.raw`(?<!\d)(?:\+?1[\s.\-]?)?(?:\(\d{3}\)|\d{3})[\s.\-]?\d{3}[\s.\-]?\d{4}(?!\d)(?:\s*(?:extension|ext|x)\.?\s*\d{1,6}(?!\d)|\s*#\s*\d{1,6}(?!\d))?`;

export type PhoneMatch = {
  /** The matched text exactly as it appeared. */
  raw: string;
  /** The bare 10 digits, country code and extension stripped, for comparison. */
  digits: string;
  index: number;
};

// Strips to the 10-digit core: drops a leading country code and anything
// from an extension marker onward. Two notes that write the same line
// differently ("(555) 123-4567" and "+1 555.123.4567") compare equal here,
// which is what makes "the same number twice is fine" work.
export function normalizePhoneDigits(raw: string): string {
  const withoutExtension = raw.replace(
    /(?:\s*(?:extension|ext|x)\.?\s*|\s*#\s*)\d{1,6}\s*$/i,
    "",
  );
  const digits = withoutExtension.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export function findPhoneNumbers(text: string): PhoneMatch[] {
  const re = new RegExp(PHONE_PATTERN, "gi");
  const out: PhoneMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ raw: m[0], digits: normalizePhoneDigits(m[0]), index: m.index });
  }
  return out;
}

// --------------------------------------------------------------------------
// Names
// --------------------------------------------------------------------------

// The dashboard's own punctuation list, verbatim: comma, semicolon, pipe,
// colon, hyphen, en dash, em dash. Each becomes a space; NOTHING else is
// touched.
//
// Two consequences, both intended. Apostrophes are not on the list, so
// "o'brien" survives as "O'Brien" (toTitleCase capitalises either side of
// it). Hyphens ARE on the list and get no special handling, so "Mary-Jane"
// becomes "Mary Jane" — matching the sheet rather than preserving the
// hyphen. Anything outside the list, a trailing full stop for instance,
// also survives into the name.
const PUNCTUATION_TO_SPACE = /[,;|:\-\u2013\u2014]/g;

function punctuationToSpaces(text: string): string {
  return text.replace(PUNCTUATION_TO_SPACE, " ");
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function toTitleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/\p{L}+/gu, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}

// --------------------------------------------------------------------------
// Trailing status word (single-person notes)
// --------------------------------------------------------------------------

/**
 * The status words a single-person note may carry after the phone.
 *
 * Wider than the ladder in status-from-tags.ts, on purpose. It covers every
 * ladder rung plus Opportunity, and adds three the ladder has no rung for:
 * the shorthands "nocase" and "referred", and "open". Those exist because a
 * human typed them into a note — matching them here only decides what gets
 * stripped out of a NAME, never what status a lead has, so a word with no
 * ladder equivalent costs nothing and leaving it in a name costs a wrong
 * name on a client's screen.
 */
export const NOTE_STATUS_WORDS = [
  "signed",
  "pending",
  "lost",
  "rejected",
  "no case",
  "referred out",
  "opportunity",
  "no contact",
  "declined",
  "nocase",
  "referred",
  "open",
] as const;

// Must be preceded by whitespace or one of the punctuation separators, so a
// note whose NAME is a status word ("Signed, 555-123-4567") keeps it — there
// is nothing before it to separate from.
//
// Sorted longest-first so a word that is a prefix of another cannot win the
// alternation: "referred" must not shadow "referred out", nor "no case"
// "no contact". JS backtracking would recover either way, but relying on
// that for a correctness property is not worth the subtlety.
const NOTE_STATUS_SUFFIX = new RegExp(
  "[\\s,;|:\\-\\u2013\\u2014]\\s*(" +
    [...NOTE_STATUS_WORDS]
      .sort((a, b) => b.length - a.length)
      .map((w) => w.replace(/ /g, "\\s+"))
      .join("|") +
    ")\\s*[\\s,;|:\\-\\u2013\\u2014]*$",
  "i",
);

/**
 * Splits a trailing status word off the text left after the phone was
 * removed. Informational only: the returned value is reported as
 * ParsedPerson.noteStatus and must never override the tag-derived status —
 * tags are what CallRail actually holds, this is a word someone typed.
 */
export function splitTrailingNoteStatus(text: string): {
  rest: string;
  noteStatus: string | null;
} {
  const m = text.match(NOTE_STATUS_SUFFIX);
  if (!m) return { rest: text, noteStatus: null };
  return {
    rest: text.slice(0, m.index),
    noteStatus: m[1].replace(/\s+/g, " ").trim(),
  };
}

// --------------------------------------------------------------------------
// Note structure
// --------------------------------------------------------------------------

/**
 * Everything after the FIRST "|" is a shared note. Applied before any other
 * rule and to single-person notes too, not just multi-person ones: the
 * ported spec introduces "|" under the multi-person format, but a shared
 * note is the same thing either way, and leaving it in the body would feed
 * free text into the name.
 */
export function splitSharedNote(note: string): {
  body: string;
  sharedNote: string | null;
} {
  const bar = note.indexOf("|");
  if (bar === -1) return { body: note, sharedNote: null };
  const shared = note.slice(bar + 1).trim();
  return { body: note.slice(0, bar), sharedNote: shared || null };
}

/**
 * Reads an "N Person" tag (e.g. "2 Person", "3 persons"). Returns the
 * declared count, or null when no tag declares one. A declared count of 1 is
 * returned as-is and does NOT force the multi-person path.
 */
export function declaredPersonCount(
  tags: readonly (string | null | undefined)[] | null | undefined,
): number | null {
  for (const tag of tags ?? []) {
    if (typeof tag !== "string") continue;
    const m = tag.trim().match(/^(\d{1,2})\s*persons?$/i);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

// --------------------------------------------------------------------------
// Entry point
// --------------------------------------------------------------------------

const NO_NAME = "No Name";
const NO_NUMBER = "No Number";

export function parseNote(
  note: string | null | undefined,
  options: ParseNoteOptions = {},
): ParseNoteResult {
  const raw = typeof note === "string" ? note : "";
  const { body, sharedNote } = splitSharedNote(raw);
  const trimmedBody = body.trim();

  const fail = (reason: ParseFailureReason, detail: string | null = null) =>
    ({ ok: false as const, reason, detail, sharedNote });

  if (!trimmedBody) return fail("empty_note");

  // Rule 1 — the explicit "nothing was captured" sentinel. Matched before
  // anything else so it can never be mistaken for a parse failure: it is a
  // successful parse of a note that says there is no name and no number.
  if (collapse(trimmedBody).toLowerCase() === "no name, no number") {
    return {
      ok: true,
      isMultiPerson: false,
      sharedNote,
      people: [
        {
          personSuffix: "p1",
          name: NO_NAME,
          phone: NO_NUMBER,
          statusText: null,
          noteStatus: null,
        },
      ],
    };
  }

  const declared = declaredPersonCount(options.tags);
  const segments = trimmedBody
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  // Multi-person, by either route: a tag declares N > 1, or the note splits
  // on ";" into 2+ segments.
  //
  // All-or-nothing in BOTH directions. A note where only some segments parse
  // is never quietly accepted as the subset that happened to work, and it
  // never falls through to the single-person rules either — a ";" note whose
  // segments do not all yield a name and a phone is a parse failure bound
  // for the admin queue. Falling through would merge two people's names into
  // one name field and hand the result to a firm as a single lead.
  if ((declared !== null && declared > 1) || segments.length >= 2) {
    const parsed = parsePeopleSegments(segments);
    if (!parsed.ok) {
      return fail(parsed.reason, parsed.detail);
    }
    if (declared !== null && parsed.people.length !== declared) {
      return fail(
        "declared_person_count_mismatch",
        `tag declared ${declared}, note yielded ${parsed.people.length}`,
      );
    }
    return { ok: true, isMultiPerson: true, sharedNote, people: parsed.people };
  }

  const single = parseSinglePerson(trimmedBody, options.callerIdPhone ?? null);
  if (!single.ok) return fail(single.reason, single.detail);
  return {
    ok: true,
    isMultiPerson: false,
    sharedNote,
    people: [single.person],
  };
}

// --------------------------------------------------------------------------
// Single person — rules 2, 3 and 4, in order
// --------------------------------------------------------------------------

type SingleResult =
  | { ok: true; person: ParsedPerson }
  | { ok: false; reason: ParseFailureReason; detail: string | null };

function parseSinglePerson(body: string, callerIdPhone: string | null): SingleResult {
  const phones = findPhoneNumbers(body);

  // Rule 2 — a phone was found in the note.
  if (phones.length > 0) {
    const distinct = new Set(phones.map((p) => p.digits));
    if (distinct.size > 1) {
      // A hard stop, not a fall-through: two different numbers means the
      // note describes something this parser cannot safely split into one
      // person, and no later rule could rescue it correctly.
      return {
        ok: false,
        reason: "multiple_phone_numbers",
        detail: [...distinct].join(", "),
      };
    }

    let remainder = body;
    for (const p of phones) remainder = remainder.replace(p.raw, " ");

    // A single-person note may still carry the "Status" field of the
    // "Name, Phone, Status" shape. Split it off here so it never lands in
    // the name; it is reported as noteStatus and nothing more.
    const { rest, noteStatus } = splitTrailingNoteStatus(remainder);
    remainder = rest;

    // Checked BEFORE punctuation is flattened, so a leftover digit run is
    // reported as what it is instead of silently becoming part of a name.
    if (/\d/.test(remainder)) {
      return {
        ok: false,
        reason: "name_contains_digits",
        detail: collapse(remainder),
      };
    }

    const name = collapse(punctuationToSpaces(remainder));
    if (!name) return { ok: false, reason: "no_name", detail: null };

    return {
      ok: true,
      person: {
        personSuffix: "p1",
        name: toTitleCase(name),
        phone: phones[0].raw.trim(),
        statusText: null,
        noteStatus,
      },
    };
  }

  // Rule 3 — name only: a single comma-delimited piece that ends in a comma,
  // with the phone taken from CallRail's caller ID instead of the note.
  const pieces = body.split(",").map((s) => s.trim());
  const nonEmpty = pieces.filter(Boolean);
  if (body.trim().endsWith(",") && nonEmpty.length === 1 && !/\d/.test(body)) {
    const name = collapse(punctuationToSpaces(nonEmpty[0]));
    if (name) {
      return {
        ok: true,
        person: {
          personSuffix: "p1",
          name: toTitleCase(name),
          // Null rather than a failure when CallRail sent no caller ID: a
          // name-only lead is a successful parse, so it must not land in the
          // admin queue just because the fallback was empty.
          phone: callerIdPhone?.trim() || null,
          statusText: null,
          noteStatus: null,
        },
      };
    }
  }

  // Rule 4.
  return { ok: false, reason: "unparseable", detail: null };
}

// --------------------------------------------------------------------------
// Multi person — "Name, Phone, Status" per ";"-separated segment
// --------------------------------------------------------------------------

type PeopleResult =
  | { ok: true; people: ParsedPerson[] }
  | { ok: false; reason: ParseFailureReason; detail: string | null };

function parsePeopleSegments(segments: readonly string[]): PeopleResult {
  if (segments.length < 2) {
    return {
      ok: false,
      reason: "person_missing_name_or_phone",
      detail: `expected 2 or more people, found ${segments.length}`,
    };
  }

  const people: ParsedPerson[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const parts = segments[i].split(",").map((s) => s.trim());
    const nameRaw = parts[0] ?? "";
    const phoneRaw = parts[1] ?? "";
    const statusRaw = parts.slice(2).join(", ").trim();

    const phones = findPhoneNumbers(phoneRaw);
    // Exactly one, and it must BE the field rather than merely appear in it
    // — a field holding "call 5551234567 after 6" is not a phone field.
    if (phones.length !== 1 || phones[0].raw.trim() !== phoneRaw.trim()) {
      return {
        ok: false,
        reason: "person_missing_name_or_phone",
        detail: `person ${i + 1}: no usable phone in "${phoneRaw}"`,
      };
    }

    if (/\d/.test(nameRaw)) {
      return {
        ok: false,
        reason: "name_contains_digits",
        detail: `person ${i + 1}: "${nameRaw}"`,
      };
    }
    const name = collapse(punctuationToSpaces(nameRaw));
    if (!name) {
      return {
        ok: false,
        reason: "person_missing_name_or_phone",
        detail: `person ${i + 1}: no name`,
      };
    }

    people.push({
      personSuffix: `p${i + 1}`,
      name: toTitleCase(name),
      phone: phones[0].raw.trim(),
      statusText: statusRaw || null,
      // Multi-person status lives in statusText, which IS authoritative for
      // that person. noteStatus is the single-person-only informational
      // field, so it is always null here.
      noteStatus: null,
    });
  }

  return { ok: true, people };
}
