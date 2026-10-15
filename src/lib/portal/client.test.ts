import { afterEach, describe, expect, it } from "vitest";
import { PortalQueryTimeout, __setPortalSqlForTests, portalQuery, runExclusive } from "./client";

afterEach(() => __setPortalSqlForTests(null));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("runExclusive — one portal query at a time", () => {
  it("never lets two run at once, and keeps their order", async () => {
    let inFlight = 0;
    let peak = 0;
    const order: number[] = [];
    await Promise.all(
      [0, 1, 2, 3, 4, 5, 6, 7].map((n) =>
        runExclusive(async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await sleep(Math.random() * 5);
          order.push(n);
          inFlight -= 1;
        }),
      ),
    );
    expect(peak).toBe(1);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("releases after an error, so the next call still runs", async () => {
    await expect(runExclusive(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(runExclusive(async () => "next")).resolves.toBe("next");
  });

  it("releases after a synchronous throw inside the callback", async () => {
    await expect(
      runExclusive(() => {
        throw new Error("sync");
      }),
    ).rejects.toThrow("sync");
    await expect(runExclusive(async () => 1)).resolves.toBe(1);
  });
});

describe("portalQuery", () => {
  it("runs on the portal's own sql, one query at a time across many callers", async () => {
    let inFlight = 0;
    let peak = 0;
    const fake = {};
    __setPortalSqlForTests(fake);
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        portalQuery(`q${i}`, async (sql) => {
          expect(sql).toBe(fake);
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await sleep(2);
          inFlight -= 1;
          return [];
        }),
      ),
    );
    expect(peak).toBe(1);
  });

  it("gives up at its time limit with PortalQueryTimeout, and the next query still runs", async () => {
    __setPortalSqlForTests({});
    await expect(
      portalQuery("slow", () => new Promise(() => {}), 20),
    ).rejects.toBeInstanceOf(PortalQueryTimeout);
    await expect(portalQuery("after", async () => ["ok"])).resolves.toEqual(["ok"]);
  });

  it("a timed-out query's late answer is never delivered to anyone", async () => {
    __setPortalSqlForTests({});
    let finishLate!: (v: unknown) => void;
    const late = portalQuery("late", () => new Promise((r) => (finishLate = r)), 20);
    await expect(late).rejects.toBeInstanceOf(PortalQueryTimeout);
    const next = portalQuery("next", async () => ["next's own rows"]);
    finishLate(["the slow query's rows"]);
    await expect(next).resolves.toEqual(["next's own rows"]);
  });

  it("passes a query error through and releases", async () => {
    __setPortalSqlForTests({});
    await expect(portalQuery("bad", async () => { throw new Error("syntax"); })).rejects.toThrow("syntax");
    await expect(portalQuery("good", async () => [1])).resolves.toEqual([1]);
  });

  it("defaults to a 15s limit", async () => {
    const { PORTAL_QUERY_TIMEOUT_MS } = await import("./client");
    expect(PORTAL_QUERY_TIMEOUT_MS).toBe(15_000);
  });
});
