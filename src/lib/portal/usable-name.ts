// Which leads have a usable name. A lead whose name is a placeholder — not a
// person — is not shown in the client portal at all: not in the list, not in
// the summary cards, not in any count. A name staff typed in the admin drawer
// (name_override) always counts as usable.
//
// Unusable: missing, blank or punctuation only; only digits or phone-like;
// "No Name" in any case, spacing or punctuation; or a lead-source label such
// as "Google Local Services Ads" (seen on rows under review).
//
// ONE rule, two forms that must agree: unusableNameSql() for the portal's
// visibility SQL (db.ts visibleTo) and isUnusableName() for the row re-check
// and the admin firm page's "visible now" count. Both use explicit ASCII
// character sets, so the result never depends on the database's locale.

/** Lead-source labels that are not a person's name, already normalised. */
export const SOURCE_LABEL_KEYS = [
  "google local services ads",
  "google local services",
  "google local",
  "google lsa",
  "local services ads",
  "lsa",
  "google ads",
  "google ads extension",
  "google paid",
  "google organic",
  "google my business",
  "google business profile",
  "gmb",
  "pmax",
  "performance max",
  "ppc",
  "bing ads",
  "bing organic",
  "facebook",
  "facebook ads",
  "yelp",
  "direct",
  "website",
] as const;

export const UNUSABLE_NAME_KEYS: readonly string[] = ["no name", "noname", ...SOURCE_LABEL_KEYS];

// ASCII whitespace and ASCII punctuation (!-/ :-@ [-` {-~), nothing else.
const SEP_CLASS = " \\t\\n\\r\\f!-/:-@\\[-`{-~";
const SEP_RUN = new RegExp(`[${SEP_CLASS}]+`, "g");
const SEP_ONLY = new RegExp(`^[${SEP_CLASS}]*$`);
const PHONE_LIKE = /^[0-9 \t\n\r\f()+.\-]+$/;

/** Lower case, each run of ASCII spaces/punctuation as one space, trimmed. */
export function nameKey(value: string): string {
  return value.toLowerCase().replace(SEP_RUN, " ").trim();
}

/** True when the name is a placeholder rather than a person. */
export function isUnusableName(name: string | null | undefined): boolean {
  if (name == null) return true;
  if (SEP_ONLY.test(name)) return true;
  if (PHONE_LIKE.test(name)) return true;
  return UNUSABLE_NAME_KEYS.includes(nameKey(name));
}

/** A staff-typed name always counts; otherwise the effective name must be usable. */
export function hasUsableName(v: { name: string | null; hasNameOverride: boolean }): boolean {
  return v.hasNameOverride || !isUnusableName(v.name);
}

const KEYS_SQL = UNUSABLE_NAME_KEYS.map((k) => `'${k.replace(/'/g, "''")}'`).join(", ");

/**
 * The same test as isUnusableName, as SQL over a fixed column expression
 * (never user input). Postgres regex: [] holds the same ASCII sets, written
 * with E'' escapes so \t etc. mean the control characters.
 */
export function unusableNameSql(expr: string): string {
  return `(
         ${expr} is null
      or ${expr} ~ E'^[ \\t\\n\\r\\f!-/:-@[-\`{-~]*$'
      or ${expr} ~ E'^[0-9 \\t\\n\\r\\f()+.-]+$'
      or btrim(regexp_replace(lower(${expr}), E'[ \\t\\n\\r\\f!-/:-@[-\`{-~]+', ' ', 'g')) in (${KEYS_SQL})
    )`;
}

/** Staff typed a name in the admin drawer: name_override set and not blank. */
export const STAFF_NAMED_SQL = "(l.name_override is not null and btrim(l.name_override) <> '')";
