// The lead-sync cron route: CRON_SECRET bearer, and how it reads scope.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ options: [] as unknown[] }));
vi.mock("@/lib/leads/deps", () => ({ createSyncDeps: () => ({}) }));
vi.mock("@/lib/leads/sync", () => ({
  syncLeadsForMonth: async (_deps: unknown, options: unknown) => {
    h.options.push(options);
    return { calls: { error: null }, forms: { error: null } };
  },
}));

import { GET } from "@/app/api/cron/lead-sync/route";

const call = (qs = "", auth = "Bearer test-secret") =>
  GET(new Request(`https://x/api/cron/lead-sync${qs}`, { headers: auth ? { authorization: auth } : {} }));

beforeEach(() => {
  h.options = [];
  vi.stubEnv("CRON_SECRET", "test-secret");
});
afterEach(() => vi.unstubAllEnvs());

describe("lead-sync route", () => {
  it.each([
    ["no header", ""],
    ["a wrong secret", "Bearer nope"],
    ["the secret without Bearer", "test-secret"],
  ])("refuses %s with 401, nothing run", async (_, auth) => {
    expect((await call("?scope=mapped", auth)).status).toBe(401);
    expect(h.options).toEqual([]);
  });

  it("refuses everything when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("?scope=mapped")).status).toBe(401);
  });

  it("scope=mapped is passed through (the daily cron)", async () => {
    expect((await call("?scope=mapped")).status).toBe(200);
    expect(h.options).toEqual([{ triggeredBy: "scheduled", dryRun: false, scope: "mapped", companyIds: undefined }]);
  });

  it("a manual run with no scope covers the whole account, as before", async () => {
    await call();
    expect(h.options[0]).toMatchObject({ scope: "all", companyIds: undefined });
  });

  it("scope=all and a dry run are honoured", async () => {
    await call("?scope=all&dryRun=1");
    expect(h.options[0]).toMatchObject({ scope: "all", dryRun: true, triggeredBy: "dry-run" });
  });

  it.each(["?scope=everything", "?scope=", "?scope=MAPPED"])("refuses an unknown scope %s with 400", async (qs) => {
    expect((await call(qs)).status).toBe(400);
    expect(h.options).toEqual([]);
  });

  it("refuses scope together with companyIds", async () => {
    expect((await call("?scope=mapped&companyIds=COM1")).status).toBe(400);
    expect(h.options).toEqual([]);
  });

  it("companyIds alone still narrows a manual run", async () => {
    await call("?companyIds=COM1,COM2&dryRun=1");
    expect(h.options[0]).toMatchObject({ companyIds: ["COM1", "COM2"], dryRun: true });
  });
});
