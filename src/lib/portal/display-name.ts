// What the portal shows as a lead's name. Display only: the stored name, and
// what the admin pages show, are never changed.
//
// Some names are placeholders rather than a person: CallRail's "No Name",
// an empty value, a caller-ID number, or a lead-source label that landed in
// the name field (seen on rows under review). Those read as "Unknown
// caller" in the portal. A staff override always wins — a name fixed in the
// admin drawer shows exactly as typed.

/** Lead-source labels that are not a person's name. Compared normalised. */
const SOURCE_LABELS = [
  "Google Local Services Ads",
  "Google Local Services",
  "Google Local",
  "Google LSA",
  "Local Services Ads",
  "LSA",
  "Google Ads",
  "Google Ads Extension",
  "Google Paid",
  "Google Organic",
  "Google My Business",
  "Google Business Profile",
  "GMB",
  "PMax",
  "Performance Max",
  "PPC",
  "Bing Ads",
  "Bing Organic",
  "Facebook",
  "Facebook Ads",
  "Yelp",
  "Direct",
  "Website",
] as const;

/** Lower case, every run of non-letters/digits as one space, trimmed. */
function normalise(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const SOURCE_KEYS = new Set(SOURCE_LABELS.map(normalise));
const NO_NAME_KEYS = new Set(["no name", "noname"]);

/** Only digits and phone punctuation, with at least one digit. */
function looksLikePhone(value: string): boolean {
  return /^[\d\s()+.\-]+$/.test(value) && /\d/.test(value);
}

/** True when the name is a placeholder, not a person. */
export function isUnknownName(name: string | null | undefined): boolean {
  if (name == null) return true;
  const trimmed = name.trim();
  if (trimmed === "") return true;
  if (looksLikePhone(trimmed)) return true;
  const key = normalise(trimmed);
  return key === "" || NO_NAME_KEYS.has(key) || SOURCE_KEYS.has(key);
}

/**
 * The name the portal renders, or null for "Unknown caller". A staff
 * override is shown as typed, whatever it says.
 */
export function portalDisplayName(name: string | null, nameIsOverride: boolean): string | null {
  if (nameIsOverride && name !== null && name.trim() !== "") return name;
  return isUnknownName(name) ? null : name;
}
