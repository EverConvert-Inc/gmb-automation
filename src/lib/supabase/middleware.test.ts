import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Real regression coverage for a real production bug: CallRail's webhook
// POST was silently 307-redirected to /login by this middleware because it
// carries no Supabase session cookie (it's a server-to-server request, not
// a browser one) — confirmed via Vercel logs. Every route this middleware
// exempts must stay exempted; this test locks that in so a future edit to
// the exemption list can't silently regress a route that depends on it.
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
  })),
}));

const ENV_URL = "https://example.supabase.co";
const ENV_KEY = "test-anon-key";

describe("updateSession — auth middleware exemptions", () => {
  beforeEach(() => {
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
