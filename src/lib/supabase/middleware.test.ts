import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Real regression coverage for a real production bug: CallRail's webhook
// POST was silently 307-redirected to /login by this middleware because it
// carries no Supabase session cookie (it's a server-to-server request, not
// a browser one) — confirmed via Vercel logs. Every route this middleware
// exempts must stay exempted; this test locks that in so a future edit to
// the exemption list can't silently regress a route that depends on it.
// getUser is settable per test. Its default — no user — is exactly what the
// original six assertions below were written against, so they run unchanged.
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  dbAccess: [] as string[],
  findSecret: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ auth: { getUser: mocks.getUser } })),
}));

// For the exempt-route tests at the bottom. Every database access is recorded,
// and anything other than the webhook-secret lookup throws, so "refused before
// touching anything" is checked rather than assumed. The middleware itself
// never imports the db client, so this mock cannot affect the tests above.
vi.mock("@/lib/db/client", () => {
  const query = new Proxy(
    {},
    {
      get(_t, table) {
        mocks.dbAccess.push(`query.${String(table)}`);
        if (table === "callrailWebhookSecrets") return { findFirst: mocks.findSecret };
        throw new Error(`unexpected db.query.${String(table)}`);
      },
    },
  );
  return {
    db: new Proxy(
      {},
      {
        get(_t, prop) {
          mocks.dbAccess.push(String(prop));
          if (prop === "query") return query;
          throw new Error(`unexpected db.${String(prop)}`);
        },
      },
    ),
  };
});
vi.mock("@/lib/alerts", () => ({
  postCallrailWebhookUnconfiguredAlert: vi.fn().mockResolvedValue(undefined),
}));

const ENV_URL = "https://example.supabase.co";
const ENV_KEY = "test-anon-key";

describe("updateSession — auth middleware exemptions", () => {
  beforeEach(() => {
    mocks.getUser.mockReset();
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    process.env.NEXT_PUBLIC_SUPABASE_URL = ENV_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ENV_KEY;
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    vi.resetModules();
  });

  async function callWithPath(pathname: string) {
    const { updateSession } = await import("./middleware");
    const request = new NextRequest(`https://app.example.com${pathname}`);
    return updateSession(request);
  }

  it("does NOT redirect the CallRail Call Modified webhook — no session cookie, must reach the route handler", async () => {
    const res = await callWithPath("/api/webhooks/callrail/call-modified");
    expect(res.status).not.toBe(307);
    expect(res.headers.get("location")).toBeNull();
  });

  it("does not redirect any route under /api/webhooks/ (future webhooks too)", async () => {
    const res = await callWithPath("/api/webhooks/some-other-provider/event");
    expect(res.status).not.toBe(307);
    expect(res.headers.get("location")).toBeNull();
  });

  it("still exempts /api/cron/* (pre-existing behavior)", async () => {
    const res = await callWithPath("/api/cron/lsa-sync");
    expect(res.status).not.toBe(307);
  });

  it("still exempts /api/scans/postback exactly (pre-existing behavior)", async () => {
    const res = await callWithPath("/api/scans/postback");
    expect(res.status).not.toBe(307);
  });

  it("still redirects an ordinary unauthenticated page request to /login", async () => {
    const res = await callWithPath("/lsa/clients/123");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("still redirects an ordinary unauthenticated API route not in the exemption list", async () => {
    const res = await callWithPath("/api/lsa/clients/123");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});

// ===========================================================================
// Deny by default
// ===========================================================================

const APP = join(process.cwd(), "src", "app");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/**
 * /clients/[slug]/page.tsx -> /clients/sample-slug
 * Route-group folders like (portal) are not part of the URL, so they are
 * dropped: (portal)/portal/page.tsx serves /portal.
 */
function toPath(file: string, leaf: string): string {
  const rel = relative(APP, file)
    .split(sep)
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .join("/")
    .replace(new RegExp(`/?${leaf}$`), "");
  const path = "/" + rel.replace(/\[([^\]]+)\]/g, "sample-$1");
  return path === "/" ? "/" : path.replace(/\/$/, "");
}

const isExempt = (p: string) =>
  p.startsWith("/login") ||
  p === "/api/scans/postback" ||
  p.startsWith("/api/cron") ||
  p.startsWith("/api/webhooks/");

// Portal paths are reachable by any signed-in user by design, so they are
// not part of the INTERNAL set the deny-by-default tests below walk.
const isPortalPath = (p: string) =>
  p === "/portal" || p.startsWith("/portal/") || p === "/api/portal" || p.startsWith("/api/portal/");

// Built from the filesystem, so a page or route added later is covered without
// anyone remembering to list it here.
const PAGES = walk(APP)
  .filter((f) => f.endsWith(`${sep}page.tsx`))
  .map((f) => toPath(f, "page.tsx"))
  .filter((p) => !isExempt(p) && !isPortalPath(p));

const API_HANDLERS = walk(join(APP, "api"))
  .filter((f) => f.endsWith(`${sep}route.ts`))
  .flatMap((f) => {
    const path = toPath(f, "route.ts");
    const methods = [...readFileSync(f, "utf8").matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map(
      (m) => m[1],
    );
    return methods.map((method) => [method, path] as const);
  })
  .filter(([, p]) => !isExempt(p) && !isPortalPath(p));

const STAFF = { id: "u-staff", app_metadata: { role: "admin" }, user_metadata: {} };
const UNTAGGED = { id: "u-untagged", app_metadata: { provider: "email" }, user_metadata: {} };
const CLIENT = { id: "u-client", app_metadata: { role: "client" }, user_metadata: {} };

function signedInAs(user: object) {
  mocks.getUser.mockResolvedValue({ data: { user }, error: null });
}

async function call(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  const { updateSession } = await import("./middleware");
  return updateSession(new NextRequest(`https://app.example.com${path}`, init));
}

describe("deny by default", () => {
  beforeEach(() => {
    mocks.getUser.mockReset();
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    process.env.NEXT_PUBLIC_SUPABASE_URL = ENV_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ENV_KEY;
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    vi.useRealTimers();
  });

  // No portal page exists yet, so the route-group handling is pinned directly:
  // once one does, it must be treated as /portal, not as an internal page.
  it("drops route-group folders when turning files into URLs", () => {
    expect(toPath(join(APP, "(portal)", "portal", "page.tsx"), "page.tsx")).toBe("/portal");
    expect(toPath(join(APP, "(portal)", "portal", "login", "page.tsx"), "page.tsx")).toBe("/portal/login");
    expect(toPath(join(APP, "clients", "[slug]", "page.tsx"), "page.tsx")).toBe("/clients/sample-slug");
    expect(isPortalPath("/portal/login")).toBe(true);
    expect(isPortalPath("/portalx")).toBe(false);
  });

  it("found the routes it is meant to cover", () => {
    // Guards the filesystem walk itself: an empty list would pass every test below.
    expect(PAGES.length).toBeGreaterThanOrEqual(24);
    expect(API_HANDLERS.length).toBeGreaterThanOrEqual(79);
    expect(API_HANDLERS.filter(([m]) => m === "DELETE").length).toBeGreaterThanOrEqual(14);
  });

  describe.each([
    // An untagged account gets the plain no-access page; a client user is sent
    // to their portal. Neither ever sees the internal app or its login.
    ["untagged", UNTAGGED, "/portal/no-access"],
    ["client-role", CLIENT, "/portal"],
  ])("a signed-in %s session", (_label, user, destination) => {
    it.each(PAGES)("is redirected away from page %s", async (path) => {
      signedInAs(user);
      const res = await call(path);
      expect(res.status).toBe(307);
      const loc = new URL(res.headers.get("location")!);
      expect(loc.pathname).toBe(destination);
      // A fixed destination, no `next`: nothing to loop on.
      expect(loc.search).toBe("");
    });

    it.each(API_HANDLERS)("gets 403 on %s %s", async (method, path) => {
      signedInAs(user);
      const res = await call(path, { method });
      expect(res.status).toBe(403);
      expect(res.headers.get("location")).toBeNull();
      await expect(res.json()).resolves.toEqual({ error: "forbidden" });
    });

    it("gets 403, not a redirect, on a server action", async () => {
      signedInAs(user);
      const res = await call("/takedowns", { method: "POST", headers: { "next-action": "abc123" } });
      expect(res.status).toBe(403);
    });

    it.each(["/portal", "/portal/login", "/portal/leads", "/api/portal", "/api/portal/notes"])(
      "reaches the portal path %s",
      async (path) => {
        signedInAs(user);
        const res = await call(path);
        expect(res.status).toBe(200);
        expect(res.headers.get("location")).toBeNull();
      },
    );

    it.each(["/portalx", "/portal-admin", "/api/portalx", "/api/portal-admin"])(
      "is refused on the lookalike %s",
      async (path) => {
        signedInAs(user);
        const res = await call(path);
        expect([307, 403]).toContain(res.status);
      },
    );
  });

  describe("the internal /login page", () => {
    it("sends a signed-in CLIENT user to /portal", async () => {
      signedInAs(CLIENT);
      const res = await call("/login");
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/portal");
    });

    it("sends a signed-in client user to /portal even with ?next= set", async () => {
      signedInAs(CLIENT);
      const res = await call("/login?next=/ppc");
      expect(new URL(res.headers.get("location")!).pathname).toBe("/portal");
      expect(new URL(res.headers.get("location")!).search).toBe("");
    });

    it.each([
      ["signed out", null],
      ["untagged", UNTAGGED],
      ["staff", STAFF],
    ])("stays reachable for a %s caller", async (_label, user) => {
      if (user) signedInAs(user);
      const res = await call("/login");
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    });

    it("stays reachable while Auth is down — the role cannot be known", async () => {
      mocks.getUser.mockRejectedValue(new Error("auth down"));
      expect((await call("/login")).status).toBe(200);
    });
  });

  describe("lookalike client roles are NOT client", () => {
    it.each([
      ["capitalised", { app_metadata: { role: "Client" }, user_metadata: {} }],
      ["padded", { app_metadata: { role: "client " }, user_metadata: {} }],
      ["only in user_metadata", { app_metadata: {}, user_metadata: { role: "client" } }],
    ])("%s goes to no-access, not the portal home", async (_label, user) => {
      signedInAs(user);
      const res = await call("/settings");
      expect(new URL(res.headers.get("location")!).pathname).toBe("/portal/no-access");
      expect((await call("/login")).status).toBe(200);
    });
  });

  it("an untagged session can reach /portal/no-access", async () => {
    signedInAs(UNTAGGED);
    expect((await call("/portal/no-access")).status).toBe(200);
  });

  describe("a tagged staff session", () => {
    it.each(PAGES)("passes on page %s", async (path) => {
      signedInAs(STAFF);
      const res = await call(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    });

    it.each(API_HANDLERS)("passes on %s %s", async (method, path) => {
      signedInAs(STAFF);
      const res = await call(path, { method });
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    });

    it("passes on a server action", async () => {
      signedInAs(STAFF);
      const res = await call("/takedowns", { method: "POST", headers: { "next-action": "abc123" } });
      expect(res.status).toBe(200);
    });
  });

  describe("lookalike roles are refused", () => {
    it.each([
      ["capitalised", { app_metadata: { role: "Admin" }, user_metadata: {} }],
      ["padded", { app_metadata: { role: "admin " }, user_metadata: {} }],
      ["superadmin", { app_metadata: { role: "superadmin" }, user_metadata: {} }],
      // user_metadata is writable by the user themselves via updateUser().
      ["only in user_metadata", { app_metadata: {}, user_metadata: { role: "admin" } }],
      ["no app_metadata at all", { user_metadata: { role: "admin" } }],
    ])("%s", async (_label, user) => {
      signedInAs(user);
      expect((await call("/api/ppc/clients/x", { method: "DELETE" })).status).toBe(403);
      expect((await call("/settings")).status).toBe(307);
    });
  });

  describe("signed out", () => {
    it.each(PAGES)("page %s still redirects to /login with next, as before", async (path) => {
      const res = await call(path);
      expect(res.status).toBe(307);
      const loc = new URL(res.headers.get("location")!);
      expect(loc.pathname).toBe("/login");
      expect(loc.searchParams.get("next")).toBe(path);
    });

    it("reaches /portal/login", async () => {
      expect((await call("/portal/login")).status).toBe(200);
    });

    it("is sent to the portal login from a portal page", async () => {
      const res = await call("/portal/leads");
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/portal/login");
    });

    it("gets 401 JSON from a portal API", async () => {
      expect((await call("/api/portal/notes")).status).toBe(401);
    });
  });

  describe("exemptions", () => {
    it.each([
      ["signed out", null],
      ["untagged", UNTAGGED],
      ["staff", STAFF],
    ])("all four still pass for a %s caller", async (_label, user) => {
      if (user) signedInAs(user);
      for (const path of ["/login", "/api/scans/postback", "/api/cron/lsa-sync", "/api/webhooks/callrail/call-modified"]) {
        const res = await call(path, { method: path === "/login" ? "GET" : "POST" });
        expect(res.status, path).toBe(200);
        expect(res.headers.get("location"), path).toBeNull();
      }
    });

    it.each(["/api/scans/postback", "/api/cron/lsa-sync", "/api/webhooks/callrail/call-modified"])(
      "%s never calls Supabase Auth",
      async (path) => {
        await call(path, { method: "POST" });
        expect(mocks.getUser).not.toHaveBeenCalled();
      },
    );

    it("server-to-server paths still pass when Auth is down", async () => {
      mocks.getUser.mockRejectedValue(new Error("auth down"));
      expect((await call("/api/cron/lsa-sync")).status).toBe(200);
    });
  });

  describe("when Supabase Auth fails", () => {
    function retryable() {
      const err = Object.assign(new Error("fetch failed"), {
        name: "AuthRetryableFetchError",
        status: 0,
        __isAuthError: true,
      });
      mocks.getUser.mockResolvedValue({ data: { user: null }, error: err });
    }

    it("an unreachable Auth gives 503 on a page — not a redirect to /login", async () => {
      retryable();
      const res = await call("/ppc");
      expect(res.status).toBe(503);
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("set-cookie")).toBeNull();
    });

    it("an unreachable Auth gives 503 JSON on an API", async () => {
      retryable();
      const res = await call("/api/ppc/clients", { method: "GET" });
      expect(res.status).toBe(503);
      await expect(res.json()).resolves.toHaveProperty("error");
    });

    it("a getUser() that throws gives 503", async () => {
      mocks.getUser.mockRejectedValue(new Error("boom"));
      expect((await call("/ppc")).status).toBe(503);
    });

    it("a getUser() that never answers gives 503 after the 10s bound", async () => {
      vi.useFakeTimers();
      mocks.getUser.mockReturnValue(new Promise(() => {}));
      const pending = call("/ppc");
      await vi.advanceTimersByTimeAsync(10_000);
      expect((await pending).status).toBe(503);
    });

    it("an invalid or expired session is treated as signed out, as before", async () => {
      const err = Object.assign(new Error("invalid JWT"), {
        name: "AuthApiError",
        status: 401,
        __isAuthError: true,
      });
      mocks.getUser.mockResolvedValue({ data: { user: null }, error: err });
      const res = await call("/ppc");
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    });

    it("/login stays reachable while Auth is down", async () => {
      retryable();
      expect((await call("/login")).status).toBe(200);
    });
  });

  describe("missing Supabase env", () => {
    beforeEach(() => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    });

    it("refuses an internal page with a 503 that says what to set — it used to allow everything", async () => {
      const res = await call("/ppc");
      expect(res.status).toBe(503);
      expect(await res.text()).toContain("NEXT_PUBLIC_SUPABASE_URL");
    });

    it("refuses an API with 503 JSON", async () => {
      expect((await call("/api/ppc/clients", { method: "GET" })).status).toBe(503);
    });

    it("still serves /login and the server-to-server exemptions", async () => {
      expect((await call("/login")).status).toBe(200);
      expect((await call("/api/cron/lsa-sync")).status).toBe(200);
      expect((await call("/api/webhooks/callrail/call-modified", { method: "POST" })).status).toBe(200);
      expect((await call("/api/scans/postback", { method: "POST" })).status).toBe(200);
    });
  });
});

// ===========================================================================
// Skipping the Auth call for cron, webhook and postback weakens nothing:
// each of them still refuses a caller without its own secret or signature.
// These call the REAL route handlers.
// ===========================================================================

describe("exempt routes still verify their own callers", () => {
  beforeEach(() => {
    mocks.dbAccess.length = 0;
    mocks.findSecret.mockReset();
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.DATAFORSEO_POSTBACK_SECRET;
    delete process.env.ENCRYPTION_KEY;
  });

  const CRON_ROUTES = walk(join(APP, "api", "cron"))
    .filter((f) => f.endsWith(`${sep}route.ts`))
    .map((f) => [toPath(f, "route.ts"), "./" + relative(__dirname, f).split(sep).join("/")] as const);

  // Loaded once, up front, under its own generous timeout. Some cron routes pull
  // in heavy modules (the PDF renderer took 3s+ to import), and doing that
  // inside a test made the suite intermittently exceed vitest's 5s default.
  const cronModules = new Map<string, { GET: (req: Request) => Promise<Response> }>();
  beforeAll(async () => {
    for (const [path, modulePath] of CRON_ROUTES) {
      cronModules.set(path, await import(/* @vite-ignore */ modulePath));
    }
    await import("../../app/api/scans/postback/route");
    await import("../../app/api/webhooks/callrail/call-modified/route");
  }, 120_000);

  it("found every cron route", () => {
    expect(CRON_ROUTES.length).toBeGreaterThanOrEqual(27);
    expect(cronModules.size).toBe(CRON_ROUTES.length);
  });

  describe.each(CRON_ROUTES)("%s", (path) => {
    it.each([
      ["no Authorization header", undefined, "real-secret"],
      ["a wrong bearer", "Bearer wrong-secret", "real-secret"],
      ["the secret without 'Bearer '", "real-secret", "real-secret"],
      ["CRON_SECRET unset — an empty bearer must not match", "Bearer ", undefined],
    ])("refuses %s with 401 and touches nothing", async (_label, header, secret) => {
      if (secret) process.env.CRON_SECRET = secret;
      const mod = cronModules.get(path)!;
      const res = await mod.GET(
        new Request(`https://app.example.com${path}`, header ? { headers: { authorization: header } } : {}),
      );
      expect(res.status).toBe(401);
      expect(mocks.dbAccess).toEqual([]);
    });
  });

  describe("/api/scans/postback", () => {
    it.each([
      ["no token", "", "real-token"],
      ["a wrong token", "?token=wrong", "real-token"],
      ["DATAFORSEO_POSTBACK_SECRET unset", "?token=", undefined],
    ])("refuses %s with 401 and touches nothing", async (_label, query, secret) => {
      if (secret) process.env.DATAFORSEO_POSTBACK_SECRET = secret;
      const { POST } = await import("../../app/api/scans/postback/route");
      const res = await POST(
        new Request(`https://app.example.com/api/scans/postback${query}`, {
          method: "POST",
          body: JSON.stringify({ tasks: [] }),
        }),
      );
      expect(res.status).toBe(401);
      expect(mocks.dbAccess).toEqual([]);
    });
  });

  describe("/api/webhooks/callrail/call-modified", () => {
    const SECRET = "callrail-shared-secret";
    const body = JSON.stringify({
      resource_id: "CAL1",
      company_resource_id: "COM1",
      changes: ["note"], // not a tag change, so a VALID delivery stops before any write
      tags: [],
    });

    beforeEach(async () => {
      process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
      const { encryptString } = await import("@/lib/crypto");
      mocks.findSecret.mockResolvedValue({ callrailCompanyId: "COM1", secretEncrypted: encryptString(SECRET) });
    });

    async function deliver(signature?: string) {
      const { POST } = await import("../../app/api/webhooks/callrail/call-modified/route");
      return POST(
        new Request("https://app.example.com/api/webhooks/callrail/call-modified", {
          method: "POST",
          body,
          headers: signature === undefined ? {} : { signature },
        }),
      );
    }

    it.each([
      ["no signature", undefined],
      ["a wrong signature", "bm90LXRoZS1yaWdodC1zaWduYXR1cmU="],
      ["a signature made with a different secret", createHmac("sha1", "other").update(body).digest("base64")],
    ])("refuses %s with 401 and writes nothing", async (_label, signature) => {
      const res = await deliver(signature);
      expect(res.status).toBe(401);
      // Only the secret lookup happened — no insert, no update, no client lookups.
      expect(mocks.dbAccess).toEqual(["query", "query.callrailWebhookSecrets"]);
    });

    // Positive control: proves the 401s above come from the signature check
    // itself, not from something else in the request being malformed.
    it("accepts the same body correctly signed", async () => {
      const res = await deliver(createHmac("sha1", SECRET).update(body).digest("base64"));
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ recorded: false, reason: "not a tag change" });
    });

    it("records nothing for a company with no secret on file (its deliberate 200)", async () => {
      mocks.findSecret.mockResolvedValue(undefined);
      const res = await deliver(undefined);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ recorded: false });
      expect(mocks.dbAccess).toEqual(["query", "query.callrailWebhookSecrets"]);
    });
  });
});
