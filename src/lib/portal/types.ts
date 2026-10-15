/**
 * A firm id that came from a resolved portal SESSION — never from a URL, a
 * query string or a request body.
 *
 * Branded so the compiler enforces it: every function in db.ts takes this
 * type first, and the only place that produces one is requirePortalSession()
 * in session.ts. A route handler cannot hand db.ts a firm id it read from its
 * input without an explicit cast, which is exactly the line a review should
 * catch.
 */
export type SessionFirmId = string & { readonly __brand: "SessionFirmId" };
