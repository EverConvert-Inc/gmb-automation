// A moved lead's notes move with it: when the sync repoints a lead to another
// firm, the same transaction sets its notes' firm_id to that firm. Faked: the
// database client, recording every statement per transaction.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import type { Table } from "drizzle-orm";

type Statement = { op: string; table: string; calls: [string, unknown[]][] };
const h = vi.hoisted(() => ({ transactions: [] as Statement[][] }));

function recorder(log: Statement[]) {
  const start = (op: string) => (table: Table) => {
    const entry: Statement = { op, table: getTableName(table), calls: [] };
    log.push(entry);
    const chain: unknown = new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve([]);
        return (...args: unknown[]) => {
          entry.calls.push([String(prop), args]);
          return chain;
        };
      },
    });
    return chain;
  };
  return { update: start("update"), insert: start("insert"), delete: start("delete") };
}

vi.mock("@/lib/db/client", () => ({
  db: {
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      const log: Statement[] = [];
      h.transactions.push(log);
      await fn(recorder(log));
    },
  },
}));

import { drizzleLeadStore } from "./store";
import type { ReconcilePlan } from "./reconcile";
import type { PlannedLead } from "./types";

const OLD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NEW = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROW_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const planned = (firmId: string | null): PlannedLead => ({
  firmId,
  source: "text",
  callrailId: "CON1:11",
  personSuffix: "p1",
  callrailCompanyId: "COM1",
  occurredAt: new Date("2026-10-05T18:30:00Z"),
  rawSourceName: "Texts",
  rawTrackerId: null,
  rawNote: "Jane Doe, 555-123-4567",
  rawTags: ["Signed", "Schuerger Shunnarah NC"],
  rawFormData: null,
  customerPhoneCallerid: "555-000-1111",
  nameParsed: "Jane Doe",
  phoneParsed: "555-123-4567",
  statusParsed: "signed",
  statusTagMatched: "Signed",
  isOpportunityParsed: false,
  suggestedStatus: "signed",
  parseFailed: false,
  parseError: null,
  needsReview: firmId === null,
  possibleDuplicateOf: null,
  signedAt: null,
});

const plan = (over: Partial<ReconcilePlan>): ReconcilePlan => ({
  repoint: [],
  upsert: [],
  deleteRowIds: [],
  flagStaleRowIds: [],
  ...over,
});

/** The value a statement's .set() was given. */
const setOf = (s: Statement) => s.calls.find(([m]) => m === "set")?.[1][0] as Record<string, unknown>;
const notesUpdates = () => h.transactions.flat().filter((s) => s.table === "lead_notes");

beforeEach(() => {
  h.transactions.length = 0;
});

describe("notes follow a moved lead", () => {
  it("moved to another firm: the lead, then its notes, in ONE transaction", async () => {
    await drizzleLeadStore.applyReconciliation(
      plan({
        repoint: [{ rowId: ROW_ID, fromFirmId: OLD, toFirmId: NEW, callrailId: "CON1:11", personSuffix: "p1" }],
        upsert: [planned(NEW)],
      }),
    );
    expect(h.transactions).toHaveLength(1);
    const [tx] = h.transactions;
    expect(tx.map((s) => [s.op, s.table])).toEqual([
      ["update", "leads"],
      ["update", "lead_notes"],
      ["insert", "leads"],
    ]);
    expect(setOf(tx[0])).toMatchObject({ firmId: NEW, needsReview: false });
    // Every note on the row — the client's and staff's alike — takes the new firm.
    expect(setOf(tx[1])).toEqual({ firmId: NEW });
  });

  it("a lead that does not move: its notes are not touched", async () => {
    await drizzleLeadStore.applyReconciliation(plan({ upsert: [planned(OLD)] }));
    expect(notesUpdates()).toEqual([]);
  });

  it("demoted to the queue (firm_id null): notes keep their last firm, nothing to point them at", async () => {
    await drizzleLeadStore.applyReconciliation(
      plan({
        repoint: [{ rowId: ROW_ID, fromFirmId: OLD, toFirmId: null, callrailId: "CON1:11", personSuffix: "p1" }],
        upsert: [planned(null)],
      }),
    );
    expect(setOf(h.transactions[0][0])).toMatchObject({ firmId: null, needsReview: true });
    expect(notesUpdates()).toEqual([]);
  });

  it("deleted or flagged stale: no notes update (reconcile only deletes rows without notes)", async () => {
    await drizzleLeadStore.applyReconciliation(plan({ deleteRowIds: [ROW_ID], flagStaleRowIds: [OLD] }));
    expect(h.transactions.flat().map((s) => [s.op, s.table])).toEqual([
      ["delete", "leads"],
      ["update", "leads"],
    ]);
  });
});
