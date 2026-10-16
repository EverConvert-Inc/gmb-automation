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

const call = (qs = "", auth = "Bearer test-secret", extra: Record<string, string> = {}) =>
  GET(
    new Request(`https://x/api/cron/lead-sync${qs}`, {
      headers: { ...(auth ? { authorization: auth } : {}), ...extra },
    }),
  );
const fromCron = { "x-vercel-cron-schedule": "30 8 * * *", "user-agent": "vercel-cron/1.0" };

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

  it("the daily cron (Vercel's call) is a scheduled, mapped run", async () => {
    expect((await call("?scope=mapped", "Bearer test-secret", fromCron)).status).toBe(200);
    expect(h.options).toEqual([{ triggeredBy: "scheduled", dryRun: false, scope: "mapped", companyIds: undefined }]);
  });

  it("the same URL run by hand is manual, so it never moves the scheduled run's reach-back", async () => {
    await call("?scope=mapped");
    expect(h.options[0]).toMatchObject({ triggeredBy: "manual", scope: "mapped" });
  });

  it("a hand-run narrowed with companyIds is manual", async () => {
    await call("?companyIds=COM1");
    expect(h.options[0]).toMatchObject({ triggeredBy: "manual", companyIds: ["COM1"] });
  });

  it("a dry run is a dry run even from the cron", async () => {
    await call("?scope=mapped&dryRun=1", "Bearer test-secret", fromCron);
    expect(h.options[0]).toMatchObject({ triggeredBy: "dry-run", dryRun: true });
  });

  it("the cron header alone does not get past CRON_SECRET", async () => {
    expect((await call("?scope=mapped", "", fromCron)).status).toBe(401);
    expect(h.options).toEqual([]);
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
