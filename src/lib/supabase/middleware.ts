import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

// DENY BY DEFAULT. A signed-in session is no longer enough: only a session
// whose app_metadata.role is "admin" reaches internal pages and APIs. Anyone
// else who is signed in — an untagged account, a future client user — reaches
// only the portal. Because the allowlist names the small surface rather than
// the large one, an internal route added later is covered the moment it
// exists, without anyone remembering to list it.
//
// app_metadata, never user_metadata: user_metadata is writable by the user
// through supabase.auth.updateUser(). The role is read off the user record the
// getUser() call below already returns — the Auth server's current record, so
// tagging or untagging an account takes effect on its next request.
const ADMIN_ROLE = "admin";

// Upper bound on the Auth call. Matches checkAdmin()'s bound in
// src/lib/leads/admin-auth.ts so the two gates never disagree about how long
// is too long. A healthy /auth/v1/user round trip is a few hundred ms at most;
// 10s only trips when Auth is genuinely failing, at which point every page is
// already broken — this turns that into a fast 503 instead of a hang.
const AUTH_TIMEOUT_MS = 10_000;

// The four pre-existing exemptions, EXACTLY as they were. /login and /api/cron
// are plain prefix matches (so /loginx and /api/cronx match too); that quirk
// predates this change and is deliberately kept.
const isLogin = (p: string) => p.startsWith("/login");
const isServerToServer = (p: string) =>
  p === "/api/scans/postback" ||
  p.startsWith("/api/cron") ||
  // Server-to-server webhook deliveries (e.g. CallRail's Call Modified
  // webhook) never carry a Supabase session cookie — confirmed via real
  // Vercel logs that without this exemption CallRail's POST was 307'd to
  // /login and the webhook was never reachable in production.
  p.startsWith("/api/webhooks/");

// New paths only, matched on a segment boundary so /portalx is not a portal
// path and /apix is not an API path.
const under = (p: string, root: string) => p === root || p.startsWith(`${root}/`);
const isPortal = (p: string) => under(p, "/portal") || under(p, "/api/portal");
const isApi = (p: string) => under(p, "/api");
const PORTAL_LOGIN = "/portal/login";

class AuthTimeout extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AuthTimeout()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function unavailable(request: NextRequest, reason: string): NextResponse {
  if (isApi(request.nextUrl.pathname)) {
    return NextResponse.json({ error: reason }, { status: 503 });
  }
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Temporarily unavailable</title>` +
      `<p style="font-family:system-ui;margin:3rem auto;max-width:32rem">${reason} ` +
      `Your session is unchanged — reload in a moment.</p>`,
    { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function redirectToLogin(request: NextRequest, loginPath: string): NextResponse {
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = loginPath;
  loginUrl.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Cron, webhook and postback calls are server-to-server: they never carry a
  // session, and every one verifies its own caller (CRON_SECRET bearer, HMAC
  // signature, postback token). Skipping the Auth call means a Supabase Auth
  // outage can no longer affect them at all.
  if (isServerToServer(path)) return NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    // This used to let every request through. Deny-by-default cannot have a
    // configuration that switches it off, so a missing env now refuses
    // everything except the login page.
    if (isLogin(path)) return NextResponse.next();
    return unavailable(
      request,
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (local dev needs them too).",
    );
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  let user: { app_metadata?: Record<string, unknown> | null } | null = null;
  let transient = false;
  try {
    const { data, error } = await withTimeout(supabase.auth.getUser(), AUTH_TIMEOUT_MS);
    user = data.user ?? null;
    // Auth unreachable (network failure or a 5xx) is not the same as "signed
    // out". Treating it as signed out would bounce staff to /login during an
    // Auth outage.
    if (!user && error && isAuthRetryableFetchError(error)) transient = true;
  } catch {
    transient = true; // timed out, or threw
  }

  if (isLogin(path)) return response;

  // Fail CLOSED without logging anyone out: no access, no redirect, cookies
  // untouched, so a reload works the moment Auth recovers.
  if (transient) {
    return unavailable(request, "Sign-in service is temporarily unreachable.");
  }

  if (!user) {
    if (path === PORTAL_LOGIN) return response;
    if (isPortal(path)) {
      return isApi(path)
        ? NextResponse.json({ error: "not signed in" }, { status: 401 })
        : redirectToLogin(request, PORTAL_LOGIN);
    }
    // Unchanged for every pre-existing path, pages and APIs alike.
    return redirectToLogin(request, "/login");
  }

  if (user.app_metadata?.role === ADMIN_ROLE) return response;

  // Signed in without the staff tag: the portal is the only place left.
  if (isPortal(path)) return response;

  // Server actions arrive as POSTs to the page's own URL carrying a
  // `next-action` header; they get a 403 rather than a redirect, like an API.
  if (isApi(path) || request.headers.has("next-action")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const denied = request.nextUrl.clone();
  denied.pathname = "/login";
  denied.search = "?denied=1"; // no `next`: going back would only be denied again
  return NextResponse.redirect(denied);
}
