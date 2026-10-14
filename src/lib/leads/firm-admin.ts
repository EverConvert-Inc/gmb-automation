// Pure helpers for the firm admin surface. No DB, no network.
//
// These exist mainly because two of them have to agree with something the
// database enforces, and getting them wrong fails at write time rather than
// at review time.

/**
 * Splits a typed tag into the display form and the normalised form stored
 * alongside it.
 *
 * lead_firm_tags carries a CHECK that tag_name_lower = lower(tag_name), so
 * these two values are not independent — the application maintains the pair
 * and Postgres refuses the row if they disagree. Whitespace is collapsed
 * first so the stored value matches what routing.ts matches on: it
 * normalises with trim + lowercase + collapse, so "Smith  Law" and
 * "Smith Law" are the same rule and should not be two rows.
 */
export function normalizeTagName(raw: string): {
  tagName: string;
  tagNameLower: string;
} {
  const tagName = raw.trim().replace(/\s+/g, " ");
  return { tagName, tagNameLower: tagName.toLowerCase() };
}

/**
 * A URL-safe slug. lead_firms.slug is UNIQUE, so a collision is a 409 rather
 * than something to silently disambiguate — two firms with the same name is
 * a decision for whoever is typing, not for this function.
 */
export function slugify(raw: string): string {
  return raw
    .normalize("NFKD")
    // Strip combining marks so "Peña" slugs as "pena" rather than losing the
    // letter entirely to the non-alphanumeric pass below.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

/** CallRail company ids are opaque and case-sensitive; only trim them. */
export function normalizeCompanyId(raw: string): string {
  return raw.trim();
}

/**
 * Postgres SQLSTATEs the firm routes translate into useful HTTP responses.
 * postgres.js surfaces the code on the error object; anything else is a real
 * server error and must not be swallowed into a 4xx.
 */
export const PG_UNIQUE_VIOLATION = "23505";
export const PG_FOREIGN_KEY_VIOLATION = "23503";

export function pgErrorCode(err: unknown): string | null {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}
